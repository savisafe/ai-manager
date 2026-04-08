import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PromptProfileFileJson, ResolvedLlmPromptProfile } from "./prompt-profile.types";

@Injectable()
export class PromptProfileService implements OnModuleInit {
  private readonly logger = new Logger(PromptProfileService.name);
  private profile!: ResolvedLlmPromptProfile;

  onModuleInit(): void {
    const id = process.env.LLM_PROMPT_PROFILE?.trim() || "default";
    this.profile = this.loadResolvedProfile(id);
    this.logger.log(
      `LLM prompt profile "${this.profile.id}" (company="${this.profile.companyName}")`,
    );
  }

  getProfile(): ResolvedLlmPromptProfile {
    return this.profile;
  }

  private loadResolvedProfile(profileId: string): ResolvedLlmPromptProfile {
    const filePath = path.resolve(
      process.cwd(),
      "config",
      "prompt-profiles",
      `${profileId}.json`,
    );

    let raw: PromptProfileFileJson = {};
    try {
      const content = readFileSync(filePath, "utf8");
      raw = JSON.parse(content) as PromptProfileFileJson;
    } catch (e) {
      this.logger.warn(
        `Prompt profile file missing or invalid (${filePath}), using minimal fallback: ${e instanceof Error ? e.message : String(e)}`,
      );
      return this.fallbackProfile(profileId);
    }

    const topic = typeof raw.topic === "string" ? raw.topic.trim() : undefined;
    const forbiddenTopics = Array.isArray(raw.forbiddenTopics)
      ? raw.forbiddenTopics.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const companyName =
      typeof raw.companyName === "string" && raw.companyName.trim().length > 0
        ? raw.companyName.trim()
        : "компании";

    let scopeText: string | undefined;
    if (typeof raw.scopeFile === "string" && raw.scopeFile.trim().length > 0) {
      scopeText = this.readScopeFile(raw.scopeFile.trim()) ?? undefined;
    }

    return {
      id: profileId,
      companyName,
      topic: topic && topic.length > 0 ? topic : undefined,
      forbiddenTopics,
      scopeText,
    };
  }

  private readScopeFile(relativeOrAbsolute: string): string | null {
    try {
      const abs = path.isAbsolute(relativeOrAbsolute)
        ? relativeOrAbsolute
        : path.resolve(process.cwd(), relativeOrAbsolute);
      const text = readFileSync(abs, "utf8").trim();
      return text.length > 0 ? text : null;
    } catch (e) {
      this.logger.warn(
        `scopeFile not read (${relativeOrAbsolute}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private fallbackProfile(profileId: string): ResolvedLlmPromptProfile {
    return {
      id: profileId,
      companyName: "компании",
      forbiddenTopics: [],
    };
  }
}
