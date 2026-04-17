import { Injectable, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LlmChatMessage, LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { BotConfigurationService } from "../bot-configuration/bot-configuration.service";
import { PromptProfileService } from "../prompt-profile/prompt-profile.service";
import { RagService } from "../rag/rag.service";
import { ResolvedLlmPromptProfile } from "../prompt-profile/prompt-profile.types";
import { DEFAULT_STRICT_KNOWLEDGE_CONVERSATIONAL_PROMPT_ADDENDUM_LINES } from "../prompt-profile/strict-knowledge-conversational.defaults";
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
  handOffTriggers: HandoffRule[];
}

interface SalesScriptsConfig {
  defaultStage: string;
  nextAction: string;
  handoff?: HandoffConfig;
  stages: Record<string, StageConfig>;
  rules: SalesRule[];
}

interface KnowledgeChunk {
  id: number;
  text: string;
  tokens: Set<string>;
}

@Injectable()
export class DialogService implements OnModuleInit {
  private readonly config: SalesScriptsConfig;
  /** Статическая часть system prompt (без канала и этапа воронки). */
  private llmSystemPromptPrefix = "";
  private llmSystemPromptSuffix = "";
  private knowledgeChunks: KnowledgeChunk[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly promptProfile: PromptProfileService,
    private readonly botConfiguration: BotConfigurationService,
    private readonly ragService: RagService,
  ) {
    this.config = this.loadConfig();
  }

  onModuleInit() {
    this.refreshLlmSystemPromptStaticParts();
    this.refreshKnowledgeChunks();
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
      : await this.tryLlmReply(conversation.id, nextStage, input.channel, templateReply, input.text);
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
    for (const rule of this.config.handoff?.handOffTriggers ?? []) {
      const matched = rule.containsAny.some((word) => normalized.includes(word));
      if (matched) {
        return rule.reason;
      }
    }
    return null;
  }

  /**
   * Приветствия и мета-вопросы не требуют фрагментов БЗ — паттерны задаются в профиле
   * (`strictKnowledgeConversationalBypass`), иначе strictKnowledgeMode даёт сухой noKnowledgeReply.
   */
  private isConversationalBypassStrictKnowledge(userText: string, profile: ResolvedLlmPromptProfile): boolean {
    const cfg = profile.strictKnowledgeConversationalBypass;
    if (!cfg || cfg.patterns.length === 0) {
      return false;
    }
    const t = userText.trim().toLowerCase();
    const maxLen = cfg.maxMessageLength;
    if (t.length === 0 || t.length > maxLen) {
      return false;
    }
    return cfg.patterns.some((re) => re.test(t));
  }

  private strictKnowledgeConversationalSystemAddendum(profile: ResolvedLlmPromptProfile): string {
    const lines = profile.strictKnowledgeConversationalPromptAddendumLines;
    const resolved =
      lines === undefined
        ? DEFAULT_STRICT_KNOWLEDGE_CONVERSATIONAL_PROMPT_ADDENDUM_LINES
        : lines;
    if (resolved.length === 0) {
      return "";
    }
    return resolved.join("\n");
  }

  private async tryLlmReply(
    conversationId: string,
    stage: string,
    channel: ChannelType,
    templateFallback: string,
    userText: string,
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

    const profile = this.promptProfile.getProfile();
    const conversationalBypass =
      Boolean(profile.strictKnowledgeMode && profile.scopeText) &&
      this.isConversationalBypassStrictKnowledge(userText, profile);
    const knowledgeContext = conversationalBypass
      ? undefined
      : await this.retrieveKnowledgeContext(userText);

    if (profile.strictKnowledgeMode && profile.scopeText && !knowledgeContext && !conversationalBypass) {
      return (
        profile.noKnowledgeReply ??
        "По этому запросу в подключённой базе не нашлось подходящего фрагмента. Переформулируйте вопрос или уточните тему — я подберу ответ из документа."
      );
    }

    const system =
      this.buildSystemPrompt(stage, channel, knowledgeContext) +
      (conversationalBypass ? this.strictKnowledgeConversationalSystemAddendum(profile) : "");
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

  private refreshLlmSystemPromptStaticParts() {
    const { prefix, suffix } = this.buildLlmSystemPromptStaticParts(this.promptProfile.getProfile());
    this.llmSystemPromptPrefix = prefix;
    this.llmSystemPromptSuffix = suffix;
  }

  private refreshKnowledgeChunks() {
    const p = this.promptProfile.getProfile();
    if (!p.scopeText || p.scopeText.trim().length === 0) {
      this.knowledgeChunks = [];
      return;
    }
    const chunkSize = p.retrievalChunkSize ?? 1400;
    const overlap = Math.min(p.retrievalChunkOverlap ?? 200, Math.max(0, chunkSize - 50));
    this.knowledgeChunks = this.buildKnowledgeChunks(p.scopeText, chunkSize, overlap);
  }

  private buildSystemPrompt(stage: string, channel: ChannelType, knowledgeContext?: string): string {
    const open = this.promptProfile.getProfile().openTopicsMode;
    const stageLine = open
      ? "Режим: свободный диалог (без воронки продаж)."
      : `Текущий этап воронки: ${stage}.`;
    const knowledgeBlock = knowledgeContext
      ? `\n\nРелевантные фрагменты базы знаний для текущего запроса:\n${knowledgeContext}`
      : "";
    return `${this.llmSystemPromptPrefix}Канал: ${channel}. ${stageLine}\n${this.llmSystemPromptSuffix}${knowledgeBlock}`;
  }

  private buildLlmSystemPromptStaticParts(p: ResolvedLlmPromptProfile): { prefix: string; suffix: string } {
    const company = p.companyName;
    const topic = p.topic;
    const forbidden = p.forbiddenTopics;
    const scopeFromFile = p.scopeText;
    const neverDo = p.neverDo ?? [];
    const primaryGoals = p.primaryGoals ?? [];
    const lang = p.language ?? "русский";

    const prefixLines: string[] = [];
    if (p.persona) {
      prefixLines.push(p.persona);
    } else {
      //TODO hardcode
      prefixLines.push(`Ты — AI-менеджер компании ${company}.`);
    }
    const prefix = `${prefixLines.join("\n")}\n`;

    const lines: string[] = [];
    lines.push(`Основной язык ответов: ${lang}.`, "");

    if (primaryGoals.length > 0) {
      lines.push("Цели в этом чате:", ...primaryGoals.map((g) => `- ${g}`), "");
    } else if (p.openTopicsMode) {
      lines.push(
        "Твоя цель: вести полезный и уважительный диалог по теме собеседника, без навязывания продукта.",
        "",
      );
    } else {
      lines.push("Твоя цель: помогать клиентам в чате, консультировать и продавать по скриптам без давления.", "");
    }

    if (p.servicesHighlight) {
      lines.push("Фокус услуг и предложений:", p.servicesHighlight, "");
    }

    if (topic) {
      lines.push(
        "Рамка темы (только она, без общих отступлений):",
        topic,
        "",
        "Вне темы: за 1–2 фразы вежливо откажи, верни к продукту или предложи менеджера; не советуй по медицине, юриспруденции, инвестициям и т.п. вне рамки продукта.",
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
      lines.push(
        "",
        "База знаний подключена. Используй только факты из релевантных фрагментов ниже по запросу пользователя.",
      );
      if (p.strictKnowledgeMode) {
        lines.push(
          "- Если релевантные фрагменты не переданы или в них нет ответа по сути вопроса: скажи это коротко и по-человечески, предложи переформулировать или уточнить тему.",
          "- Не выдумывай нормы, пункты, подпункты, таблицы и числовые значения.",
        );
      }
    }

    if (p.bookingAndContact) {
      lines.push("", "Запись и контакты (не выдумывай данные):", p.bookingAndContact);
    }

    if (p.humanLikeMode) {
      lines.push(
        "",
        "Режим «как живой человек» (тема и факты не ослабляй):",
        "- Меняй формулировки, избегай шаблонных вступлений подряд; допустим разговорный тон, без канцелярита и «отчётных» списков ради списка.",
        "- Не превращай каждый ответ в FAQ: 1–2 живых абзаца; покажи, что услышал запрос, без воды и лишних извинений.",
        "- Смайлики по минимуму (один нейтральный или без них); без «рад видеть» в каждом сообщении.",
      );
    }

    const styleLead = p.humanLikeMode
      ? "- Пиши коротко и по-человечески: дружелюбно, без сухого отчёта."
      : "- Пиши коротко, дружелюбно.";

    if (p.openTopicsMode) {
      lines.push(
        "",
        "Правила стиля:",
        styleLead,
        "- Развивай беседу по запросу пользователя; не уводи насильно к продаже или к одной нише.",
        "- Не выдавай за факт то, чего не знаешь; при сложных вопросах (медицина, право, финансы) — общая информация и рекомендация обратиться к специалисту, без диагнозов и юридических заключений.",
        p.humanLikeMode
          ? "- В конце можно один уточняющий вопрос или предложение продолжить тему — по ситуации."
          : "- Один ответ = несколько коротких абзацев по делу.",
      );
    } else {
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
    }

    if (p.additionalStyleRules?.length) {
      for (const rule of p.additionalStyleRules) {
        lines.push(`- ${rule}`);
      }
    }

    return { prefix, suffix: lines.join("\n") };
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

  private buildKnowledgeChunks(scopeText: string, chunkSize: number, overlap: number): KnowledgeChunk[] {
    const normalized = scopeText.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      return [];
    }

    const chunks: KnowledgeChunk[] = [];
    let start = 0;
    let id = 1;
    while (start < normalized.length) {
      const end = Math.min(normalized.length, start + chunkSize);
      const cut = this.findChunkBoundary(normalized, start, end);
      const text = normalized.slice(start, cut).trim();
      if (text.length > 0) {
        chunks.push({ id, text, tokens: new Set(this.tokenizeForRetrieval(text)) });
        id += 1;
      }
      if (cut >= normalized.length) {
        break;
      }
      start = Math.max(cut - overlap, start + 1);
    }
    return chunks;
  }

  private findChunkBoundary(text: string, start: number, targetEnd: number): number {
    if (targetEnd >= text.length) {
      return text.length;
    }
    const breakpoints = ["\n\n", "\n", ". ", "; ", ", "];
    for (const point of breakpoints) {
      const idx = text.lastIndexOf(point, targetEnd);
      if (idx > start + 200) {
        return idx + point.length;
      }
    }
    return targetEnd;
  }

  private async retrieveKnowledgeContext(userText: string): Promise<string | undefined> {
    const config = this.botConfiguration.get();
    
    // Если включён RAG — используем векторный поиск
    if (config.useRag) {
      return await this.retrieveKnowledgeContextRag(userText);
    }
    
    // Иначе — лексический поиск по токенам
    if (this.knowledgeChunks.length === 0) {
      return undefined;
    }
    const queryTokens = this.tokenizeForRetrieval(userText);
    if (queryTokens.length === 0) {
      return undefined;
    }
    const querySet = new Set(queryTokens);
    const scored = this.knowledgeChunks
      .map((chunk) => {
        let overlap = 0;
        for (const token of querySet) {
          if (chunk.tokens.has(token)) {
            overlap += 1;
          }
        }
        return { chunk, overlap };
      })
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || a.chunk.id - b.chunk.id);

    if (scored.length === 0) {
      return undefined;
    }

    const topK = this.promptProfile.getProfile().retrievalTopK ?? 3;
    return scored
      .slice(0, topK)
      .map((x) => `[Фрагмент ${x.chunk.id}, совпадений: ${x.overlap}]\n${x.chunk.text}`)
      .join("\n\n---\n\n");
  }

  private async retrieveKnowledgeContextRag(userText: string): Promise<string | undefined> {
    const results = await this.ragService.search(userText, 3);
    
    if (results.length === 0) {
      return undefined;
    }

    return results
      .map((r, i) => `[Релевантность: ${(r.score * 100).toFixed(1)}%]\n${r.text}`)
      .join("\n\n---\n\n");
  }

  private tokenizeForRetrieval(text: string): string[] {
    const raw = text
      .toLowerCase()
      .replace(/ё/g, "е")
      .split(/[^a-zа-я0-9.]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    const stopWords = new Set([
      "и",
      "в",
      "на",
      "по",
      "с",
      "для",
      "к",
      "о",
      "об",
      "от",
      "до",
      "или",
      "что",
      "как",
      "какой",
      "какие",
      "это",
      "пункт",
      "подпункт",
    ]);
    return raw.filter((t) => !stopWords.has(t));
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
        handOffTriggers: [],
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
