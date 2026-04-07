import { Injectable } from "@nestjs/common";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LlmChatMessage, LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { ChannelType, DialogInput, DialogOutput } from "./dialog.types";

interface SalesRule {
  containsAny: string[];
  setStage: string;
}

interface HandoffRule {
  containsAny: string[];
  reason: string;
}

interface StageConfig {
  replyLines: string[];
}

interface HandoffConfig {
  nextAction: string;
  replyLines: string[];
  rules: HandoffRule[];
}

interface SalesScriptsConfig {
  defaultStage: string;
  nextAction: string;
  handoff?: HandoffConfig;
  stages: Record<string, StageConfig>;
  rules: SalesRule[];
}

@Injectable()
export class DialogService {
  private readonly config: SalesScriptsConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {
    this.config = this.loadConfig();
  }

  async process(input: DialogInput): Promise<DialogOutput> {
    const { conversation } = await this.getOrCreateConversation(
      input.channel,
      input.externalUserId,
    );

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "client",
        text: input.text,
      },
    });

    const handoffReason = this.detectHandoffReason(input.text);
    const nextStage = handoffReason
      ? "handoff"
      : this.detectStage(input.text, conversation.stage);
    const templateReply = this.buildReply(nextStage, input.text);
    const replyText = handoffReason
      ? this.buildHandoffReply()
      : await this.tryLlmReply(conversation.id, nextStage, input.channel, templateReply);
    const nextAction = handoffReason
      ? this.config.handoff?.nextAction ?? "await_human_manager"
      : this.config.nextAction;

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        stage: nextStage,
        status: handoffReason ? "HANDED_OFF" : "ACTIVE",
      },
    });

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        text: replyText,
      },
    });

    await this.prisma.leadState.upsert({
      where: { conversationId: conversation.id },
      update: { need: input.text, nextAction },
      create: {
        conversationId: conversation.id,
        need: input.text,
        nextAction,
      },
    });

    if (handoffReason) {
      await this.prisma.handoffEvent.create({
        data: {
          conversationId: conversation.id,
          reason: handoffReason,
        },
      });
    }

    return { replyText, stage: nextStage };
  }

  private async getOrCreateConversation(channel: string, externalUserId: string) {
    const user = await this.prisma.user.upsert({
      where: {
        channel_externalId: {
          channel,
          externalId: externalUserId,
        },
      },
      update: {},
      create: {
        channel,
        externalId: externalUserId,
      },
    });

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        userId: user.id,
        status: "ACTIVE",
      },
      orderBy: { createdAt: "desc" },
    });

    if (conversation) {
      return { user, conversation };
    }

    const createdConversation = await this.prisma.conversation.create({
      data: { userId: user.id },
    });

    return { user, conversation: createdConversation };
  }

  private detectStage(text: string, currentStage: string): string {
    const normalized = text.toLowerCase();
    for (const rule of this.config.rules) {
      const matched = rule.containsAny.some((word) => normalized.includes(word));
      if (matched) {
        return rule.setStage;
      }
    }
    if (currentStage === this.config.defaultStage) {
      return "qualification";
    }
    return currentStage;
  }

  private buildReply(stage: string, clientText: string): string {
    const fallback = this.config.stages[this.config.defaultStage];
    const selected = this.config.stages[stage] ?? fallback;
    return selected.replyLines.map((line) => line.replace("{clientText}", clientText)).join("\n");
  }

  private detectHandoffReason(text: string): string | null {
    const normalized = text.toLowerCase();
    for (const rule of this.config.handoff?.rules ?? []) {
      const matched = rule.containsAny.some((word) => normalized.includes(word));
      if (matched) {
        return rule.reason;
      }
    }
    return null;
  }

  private async tryLlmReply(
    conversationId: string,
    stage: string,
    channel: ChannelType,
    templateFallback: string,
  ): Promise<string> {
    if (!this.llmService.isEnabled()) {
      return templateFallback;
    }

    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 16,
    });
    rows.reverse();

    const system = this.buildSystemPrompt(stage, channel);
    const messages: LlmChatMessage[] = [
      { role: "system", content: system },
      ...rows.map((m) => ({
        role: (m.role === "client" ? "user" : "assistant") as "user" | "assistant",
        content: m.text,
      })),
    ];

    const out = await this.llmService.complete(messages);
    return out ?? templateFallback;
  }

  private buildSystemPrompt(stage: string, channel: ChannelType): string {
    const company = process.env.COMPANY_NAME ?? "компании";
    const topic = process.env.LLM_TOPIC?.trim();
    const forbiddenRaw = process.env.LLM_FORBIDDEN_TOPICS?.trim();
    const forbidden = forbiddenRaw
      ? forbiddenRaw
          .split(/[,|]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const scopeFromFile = this.readOptionalTextFile(process.env.LLM_SCOPE_FILE);

    const lines: string[] = [
      `Ты — AI-менеджер компании ${company}.`,
      `Канал: ${channel}. Текущий этап воронки: ${stage}.`,
      "",
      "Твоя цель: помогать клиентам в чате, консультировать и продавать по скриптам без давления.",
    ];

    if (topic) {
      lines.push(
        "",
        "Рамка темы (держись только её; не уходи в общие разговоры):",
        topic,
        "",
        "Если вопрос вне этой темы:",
        "- За 1–2 коротких предложения вежливо скажи, что это вне компетенции в чате.",
        "- Сразу верни разговор к задаче клиента в рамках темы выше или предложи передать вопрос менеджеру.",
        "- Не давай советов по сторонним областям (медицина, юриспруденция, инвестиции и т.п.), если это не напрямую связано с продуктом в рамке темы.",
      );
    }

    if (forbidden.length > 0) {
      lines.push(
        "",
        "Не обсуждай и не развивай эти темы (даже по просьбе клиента):",
        ...forbidden.map((f) => `- ${f}`),
      );
    }

    if (scopeFromFile) {
      lines.push("", "Дополнительные инструкции компании (приоритетны для фактов о продукте):", scopeFromFile);
    }

    lines.push(
      "",
      "Правила стиля и продаж:",
      "- Пиши коротко, по-русски, дружелюбно.",
      "- Сначала уточняй потребность, потом предлагай решение.",
      "- Не выдумывай цены, сроки и условия; если данных нет — скажи, что уточнит менеджер.",
      "- Один ответ = несколько коротких абзацев, в конце один конкретный следующий шаг.",
    );

    return lines.join("\n");
  }

  private readOptionalTextFile(relativeOrAbsolute?: string): string | null {
    const raw = relativeOrAbsolute?.trim();
    if (!raw) {
      return null;
    }
    try {
      const abs = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
      const text = readFileSync(abs, "utf8").trim();
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  private buildHandoffReply(): string {
    const lines = this.config.handoff?.replyLines;
    if (!lines || lines.length === 0) {
      return [
        "Передаю ваш запрос профильному менеджеру, чтобы дать максимально точный ответ.",
        "Оставайтесь на связи, пожалуйста.",
      ].join("\n");
    }
    return lines.join("\n");
  }

  private loadConfig(): SalesScriptsConfig {
    const fallback: SalesScriptsConfig = {
      defaultStage: "contact",
      nextAction: "await_client_reply",
      handoff: {
        nextAction: "await_human_manager",
        replyLines: [
          "Передаю ваш запрос профильному менеджеру, чтобы дать максимально точный ответ.",
          "Оставайтесь на связи, пожалуйста.",
        ],
        rules: [],
      },
      stages: {
        contact: {
          replyLines: [
            "Спасибо за сообщение!",
            "Я помогу с консультацией и подбором решения.",
            "Расскажите, пожалуйста, какая задача сейчас самая приоритетная?",
          ],
        },
        qualification: {
          replyLines: [
            "Спасибо за обращение.",
            "Правильно понял, что запрос такой: \"{clientText}\"?",
            "Подскажите, пожалуйста, срок и желаемый бюджет, чтобы предложить лучший вариант.",
          ],
        },
      },
      rules: [],
    };

    try {
      const configPath = path.resolve(process.cwd(), "scripts", "sales-scripts.json");
      const content = readFileSync(configPath, "utf8");
      return JSON.parse(content) as SalesScriptsConfig;
    } catch {
      return fallback;
    }
  }
}
