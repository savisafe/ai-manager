import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LlmChatMessage, LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { BotConfigurationService } from "../bot-configuration/bot-configuration.service";
import { PromptProfileService } from "../prompt-profile/prompt-profile.service";
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
    private readonly promptProfile: PromptProfileService,
    private readonly botConfiguration: BotConfigurationService,
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
    const user = await this.getOrCreateUser(channel, externalUserId);

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

  private async getOrCreateUser(channel: string, externalUserId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { channel, externalId: externalUserId },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.user.create({
        data: { channel, externalId: externalUserId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const retry = await this.prisma.user.findFirst({
          where: { channel, externalId: externalUserId },
        });
        if (retry) {
          return retry;
        }
      }
      throw e;
    }
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

    const contextLimit = this.getLlmContextMessageLimit();
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: contextLimit,
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
    const p = this.promptProfile.getProfile();
    const company = p.companyName;
    const topic = p.topic;
    const forbidden = p.forbiddenTopics;
    const scopeFromFile = p.scopeText;
    const neverDo = p.neverDo ?? [];
    const primaryGoals = p.primaryGoals ?? [];
    const lang = p.language ?? "русский";

    const lines: string[] = [];
    if (p.persona) {
      lines.push(p.persona);
    } else {
      lines.push(`Ты — AI-менеджер компании ${company}.`);
    }
    lines.push(`Канал: ${channel}. Текущий этап воронки: ${stage}.`, `Основной язык ответов: ${lang}.`, "");

    if (primaryGoals.length > 0) {
      lines.push("Цели в этом чате:", ...primaryGoals.map((g) => `- ${g}`), "");
    } else {
      lines.push("Твоя цель: помогать клиентам в чате, консультировать и продавать по скриптам без давления.", "");
    }

    if (p.servicesHighlight) {
      lines.push("Фокус услуг и предложений:", p.servicesHighlight, "");
    }

    if (topic) {
      lines.push(
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

    if (neverDo.length > 0) {
      lines.push("", "Категорически:", ...neverDo.map((f) => `- ${f}`));
    }

    if (scopeFromFile) {
      lines.push("", "Дополнительные инструкции компании (приоритетны для фактов о продукте):", scopeFromFile);
    }

    if (p.bookingAndContact) {
      lines.push("", "Запись и контакты (без выдуманных данных):", p.bookingAndContact);
    }

    if (p.humanLikeMode) {
      lines.push(
        "",
        "Режим «как живой человек» (тема и факты не ослабляй):",
        "- Меняй формулировки от сообщения к сообщению; избегай одних и тех же шаблонных вступлений подряд.",
        "- Допустимы мягкие связки и разговорный тон там, где уместно; без канцелярита и «отчётного» списка ради списка.",
        "- Не превращай каждый ответ в маркированный FAQ: в мессенджере лучше 1–2 живых абзаца, списки — только если клиенту так проще воспринять.",
        "- Кратко покажи, что услышал запрос, без воды и без избыточных извинений.",
        "- Смайлики — по минимуму (один нейтральный или без них); без канцелярского «рад вас видеть» в каждом сообщении.",
      );
    }

    const styleLead = p.humanLikeMode
      ? "- Пиши коротко и по-человечески: дружелюбно, без сухого отчёта."
      : "- Пиши коротко, дружелюбно.";

    lines.push(
      "",
      "Правила стиля и продаж:",
      styleLead,
      "- Сначала уточняй потребность, потом предлагай решение.",
      "- Не выдумывай цены, сроки и условия; если данных нет — скажи, что уточнит менеджер.",
      p.humanLikeMode
        ? "- В конце — один ясный следующий шаг или вопрос; не обязательно «официальное» закрытие абзаца."
        : "- Один ответ = несколько коротких абзацев, в конце один конкретный следующий шаг.",
    );

    if (p.additionalStyleRules?.length) {
      for (const rule of p.additionalStyleRules) {
        lines.push(`- ${rule}`);
      }
    }

    return lines.join("\n");
  }

  /** Сколько последних сообщений диалога отдавать в LLM (меньше — быстрее префилл и инференс). */
  private getLlmContextMessageLimit(): number {
    const raw = process.env.LLM_CONTEXT_MESSAGES?.trim();
    if (raw === undefined || raw === "") {
      return 16;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return 16;
    }
    return Math.min(50, Math.max(2, Math.floor(n)));
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
      const relative = this.botConfiguration.get().salesScriptsPath;
      const configPath = path.resolve(process.cwd(), relative);
      const content = readFileSync(configPath, "utf8");
      return JSON.parse(content) as SalesScriptsConfig;
    } catch {
      return fallback;
    }
  }
}
