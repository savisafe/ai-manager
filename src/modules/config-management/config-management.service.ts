import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  BotConfigurationFileJson,
  ResolvedBotConfiguration,
} from "../bot-configuration/bot-configuration.types";
import { PromptProfileService } from "../prompt-profile/prompt-profile.service";
import { PromptProfileFileJson, ResolvedLlmPromptProfile } from "../prompt-profile/prompt-profile.types";
import { SalesScriptsConfig } from "../dialog/sales-script-config.types";
import { ResolvedDialogResourceBundle } from "./config-management.types";

type BundleCacheEntry = { expiresAt: number; value: ResolvedDialogResourceBundle };

@Injectable()
export class ConfigManagementService {
  private readonly logger = new Logger(ConfigManagementService.name);
  private readonly cache = new Map<string, BundleCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly promptProfileService: PromptProfileService,
  ) {}

  invalidateCacheForConfiguration(configurationKey: string): void {
    this.cache.delete(`bundle:${configurationKey}`);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Разрешает сборку бота по id/slug строки в БД или, если записи нет, по имени файла config/configurations/<id>.json.
   * Профиль: сначала Prisma PromptProfile по slug = llmPromptProfile, иначе JSON с диска.
   * Скрипт: salesScriptSlug → Prisma SalesScript; иначе файл salesScriptsPath.
   */
  async resolveDialogResourceBundle(configurationId: string): Promise<ResolvedDialogResourceBundle> {
    const ttlMs = this.getCacheTtlMs();
    const cacheKey = `bundle:${configurationId}`;
    if (ttlMs > 0) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        return hit.value;
      }
    }

    const { bot, raw } = await this.loadBotConfigurationPayload(configurationId);
    const profile = await this.resolvePromptProfile(bot.llmPromptProfile, raw);
    const sales = await this.resolveSalesScripts(bot, raw);

    const bundle: ResolvedDialogResourceBundle = { bot, profile, sales };
    if (ttlMs > 0) {
      this.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value: bundle });
    }
    return bundle;
  }

  private getCacheTtlMs(): number {
    const raw = process.env.CONFIG_MGMT_CACHE_TTL_MS?.trim();
    if (!raw) {
      return 0;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }
    return Math.min(300_000, Math.floor(n));
  }

  private async loadBotConfigurationPayload(
    configurationId: string,
  ): Promise<{ bot: ResolvedBotConfiguration; raw: BotConfigurationFileJson }> {
    const row = await this.prisma.botConfiguration.findFirst({
      where: { OR: [{ id: configurationId }, { slug: configurationId }] },
    });
    if (row) {
      const raw = this.asJsonObject(row.data) as BotConfigurationFileJson;
      const bot = this.resolveBotFields(raw, row.id);
      return { bot, raw };
    }
    return { bot: this.loadBotFromFilesystem(configurationId), raw: this.readBotJsonFile(configurationId) };
  }

  private readBotJsonFile(configurationId: string): BotConfigurationFileJson {
    const filePath = path.resolve(process.cwd(), "config", "configurations", `${configurationId}.json`);
    try {
      const content = readFileSync(filePath, "utf8");
      return JSON.parse(content) as BotConfigurationFileJson;
    } catch (e) {
      this.logger.warn(
        `Bot configuration file missing (${filePath}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return {};
    }
  }

  private loadBotFromFilesystem(configurationId: string): ResolvedBotConfiguration {
    const raw = this.readBotJsonFile(configurationId);
    return this.resolveBotFields(raw, configurationId);
  }

  private resolveBotFields(
    raw: BotConfigurationFileJson,
    /** Slug файла конфигурации или id строки в БД */
    resolvedId: string,
  ): ResolvedBotConfiguration {
    const llmPromptProfile =
      (typeof raw.llmPromptProfile === "string" && raw.llmPromptProfile.trim().length > 0
        ? raw.llmPromptProfile.trim()
        : undefined) ??
      process.env.LLM_PROMPT_PROFILE?.trim() ??
      "default";

    const salesScriptsPath =
      (typeof raw.salesScriptsPath === "string" && raw.salesScriptsPath.trim().length > 0
        ? raw.salesScriptsPath.trim()
        : undefined) ?? "scripts/sales-scripts.json";

    const rawUseRag = raw.useRag;
    const useRag =
      rawUseRag === true || (typeof rawUseRag === "string" && rawUseRag.trim().toLowerCase() === "true");

    return {
      id: resolvedId,
      llmPromptProfile,
      salesScriptsPath,
      useRag,
    };
  }

  private async resolvePromptProfile(
    profileSlug: string,
    botRaw: BotConfigurationFileJson,
  ): Promise<ResolvedLlmPromptProfile> {
    const row = await this.prisma.promptProfile.findUnique({ where: { slug: profileSlug } });
    if (row) {
      const raw = this.asJsonObject(row.data) as PromptProfileFileJson;
      return this.promptProfileService.resolveFromPromptProfileJson(profileSlug, raw);
    }
    return this.promptProfileService.resolveProfileFromFilesystem(profileSlug);
  }

  private async resolveSalesScripts(
    bot: ResolvedBotConfiguration,
    botRaw: BotConfigurationFileJson,
  ): Promise<SalesScriptsConfig> {
    const slug =
      typeof botRaw.salesScriptSlug === "string" && botRaw.salesScriptSlug.trim().length > 0
        ? botRaw.salesScriptSlug.trim()
        : undefined;
    if (slug) {
      const row = await this.prisma.salesScript.findUnique({ where: { slug } });
      if (!row) {
        throw new NotFoundException(`SalesScript slug not found: ${slug}`);
      }
      return this.parseSalesScripts(row.data);
    }
    return this.loadSalesFromFilesystem(bot.salesScriptsPath);
  }

  private loadSalesFromFilesystem(relativePath: string): SalesScriptsConfig {
    try {
      const configPath = path.resolve(process.cwd(), relativePath);
      const content = readFileSync(configPath, "utf8");
      return this.parseSalesScripts(JSON.parse(content));
    } catch (e) {
      this.logger.warn(`Sales script file read failed (${relativePath}): ${e instanceof Error ? e.message : String(e)}`);
      return this.fallbackSalesScripts();
    }
  }

  private parseSalesScripts(json: unknown): SalesScriptsConfig {
    const fallback = this.fallbackSalesScripts();
    if (!json || typeof json !== "object") {
      return fallback;
    }
    const o = json as Record<string, unknown>;
    const defaultStage = typeof o.defaultStage === "string" ? o.defaultStage : fallback.defaultStage;
    const nextAction = typeof o.nextAction === "string" ? o.nextAction : fallback.nextAction;
    const stages =
      o.stages && typeof o.stages === "object" ? (o.stages as SalesScriptsConfig["stages"]) : fallback.stages;
    const rules = Array.isArray(o.rules) ? (o.rules as SalesScriptsConfig["rules"]) : fallback.rules;
    const handoff =
      o.handoff && typeof o.handoff === "object" ? (o.handoff as SalesScriptsConfig["handoff"]) : fallback.handoff;
    return { defaultStage, nextAction, stages, rules, handoff };
  }

  private fallbackSalesScripts(): SalesScriptsConfig {
    return {
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
  }

  private asJsonObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
}
