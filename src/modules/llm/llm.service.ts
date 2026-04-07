import { Injectable, Logger } from "@nestjs/common";

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  isEnabled(): boolean {
    const v = process.env.LLM_ENABLED?.toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }

  /**
   * OpenAI-compatible chat (Ollama: http://localhost:11434/v1).
   * Returns null if disabled, misconfigured, or request fails (caller uses script fallback).
   */
  async complete(messages: LlmChatMessage[]): Promise<string | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const baseUrl = (process.env.LLM_BASE_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
    const model = process.env.LLM_MODEL ?? "llama3";
    const apiKey = process.env.LLM_API_KEY ?? "ollama";

    const maxTokensRaw = process.env.LLM_MAX_TOKENS;
    const maxTokens =
      maxTokensRaw !== undefined && maxTokensRaw !== ""
        ? Number(maxTokensRaw)
        : undefined;

    const url = `${baseUrl}/chat/completions`;
    try {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: Number(process.env.LLM_TEMPERATURE ?? 0.7),
      };
      if (maxTokens !== undefined && !Number.isNaN(maxTokens) && maxTokens > 0) {
        body.max_tokens = maxTokens;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(`LLM HTTP ${response.status}: ${errText}`);
        return null;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      return text && text.length > 0 ? text : null;
    } catch (error) {
      this.logger.warn(`LLM request failed: ${error}`);
      return null;
    }
  }
}
