import { Injectable, Logger } from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { DialogService } from "../dialog/dialog.service";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { isDevelopment } from "../shared/is-development";
import {
  IncomingTelegramMessage,
  TelegramWebhookPayload,
} from "./telegram.types";

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  constructor(
    private readonly dialogService: DialogService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  extractMessage(payload: TelegramWebhookPayload): IncomingTelegramMessage | null {
    const message = payload.message;
    const text = message?.text?.trim();
    const chatId = message?.chat?.id;

    if (!text || typeof chatId !== "number") {
      return null;
    }

    return {
      chatId,
      text,
      messageId: message?.message_id,
    };
  }

  async handleIncoming(payload: TelegramWebhookPayload): Promise<void> {
    const message = this.extractMessage(payload);
    if (!message) {
      return;
    }

    const shouldProcess = await this.idempotencyService.tryProcess(
      "telegram",
      message.messageId?.toString(),
    );
    if (!shouldProcess) {
      this.logger.warn(`Duplicate Telegram message skipped: ${message.messageId ?? "unknown"}`);
      return;
    }

    const dev = isDevelopment();
    const preview =
      message.text.length > 120 ? `${message.text.slice(0, 120)}…` : message.text;
    const flowStarted = dev ? performance.now() : 0;
    if (dev) {
      this.logger.log(
        `[Telegram] 1/3 received chatId=${message.chatId} messageId=${message.messageId ?? "n/a"}: ${preview}`,
      );
    }

    const dialogStarted = dev ? performance.now() : 0;
    const result = await this.dialogService.process({
      channel: "telegram",
      externalUserId: String(message.chatId),
      text: message.text,
    });
    if (dev) {
      const dialogMs = Math.round(performance.now() - dialogStarted);
      this.logger.log(
        `[Telegram] 2/3 dialog done chatId=${message.chatId} stage=${result.stage} in ${dialogMs}ms`,
      );
    }

    const sendStarted = dev ? performance.now() : 0;
    const sent = await this.sendMessage(message.chatId, result.replyText);
    if (dev) {
      const sendMs = Math.round(performance.now() - sendStarted);
      const totalMs = Math.round(performance.now() - flowStarted);
      this.logger.log(
        `[Telegram] 3/3 ${sent ? "reply sent to bot" : "reply NOT sent (see errors above)"} chatId=${message.chatId} in ${sendMs}ms | total ${totalMs}ms (webhook → user sees message)`,
      );
    }
  }

  async sendMessage(chatId: number, text: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn("TELEGRAM_BOT_TOKEN is not set");
      return false;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Telegram send failed: ${response.status} ${errText}`);
      return false;
    }
    return true;
  }
}
