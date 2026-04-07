import { Injectable, Logger } from "@nestjs/common";
import { DialogService } from "../dialog/dialog.service";
import { IdempotencyService } from "../idempotency/idempotency.service";
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

    this.logger.log(`Incoming Telegram message from ${message.chatId}: ${message.text}`);
    const result = await this.dialogService.process({
      channel: "telegram",
      externalUserId: String(message.chatId),
      text: message.text,
    });
    await this.sendMessage(message.chatId, result.replyText);
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn("TELEGRAM_BOT_TOKEN is not set");
      return;
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
    }
  }
}
