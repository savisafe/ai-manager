import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DialogService } from "../dialog/dialog.service";
import { IdempotencyService } from "../idempotency/idempotency.service";
import {
  IncomingWhatsAppMessage,
  WhatsAppWebhookPayload,
} from "./whatsapp.types";

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  constructor(
    private readonly dialogService: DialogService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  verifyWebhook(mode?: string, token?: string, challenge?: string): string | null {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) {
      this.logger.error("WHATSAPP_VERIFY_TOKEN is not set");
      return null;
    }

    if (mode === "subscribe" && token === verifyToken) {
      return challenge ?? "";
    }

    return null;
  }

  extractMessages(payload: WhatsAppWebhookPayload): IncomingWhatsAppMessage[] {
    const result: IncomingWhatsAppMessage[] = [];
    const entries = payload.entry ?? [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const message of messages) {
          if (message.type !== "text") {
            continue;
          }
          const text = message.text?.body?.trim();
          const from = message.from?.trim();
          if (!text || !from) {
            continue;
          }
          result.push({
            from,
            text,
            messageId: message.id,
          });
        }
      }
    }

    return result;
  }

  verifySignature(rawBody: Buffer | undefined, signatureHeader?: string): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      this.logger.warn("WHATSAPP_APP_SECRET is not set, skipping signature verification");
      return true;
    }

    if (!rawBody || !signatureHeader?.startsWith("sha256=")) {
      return false;
    }

    const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const incoming = signatureHeader.slice("sha256=".length);

    const expectedBuf = Buffer.from(expected, "hex");
    const incomingBuf = Buffer.from(incoming, "hex");
    if (expectedBuf.length !== incomingBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, incomingBuf);
  }

  async handleIncoming(payload: WhatsAppWebhookPayload): Promise<void> {
    const messages = this.extractMessages(payload);

    for (const message of messages) {
      const shouldProcess = await this.idempotencyService.tryProcess(
        "whatsapp",
        message.messageId,
      );
      if (!shouldProcess) {
        this.logger.warn(`Duplicate WhatsApp message skipped: ${message.messageId ?? "unknown"}`);
        continue;
      }

      this.logger.log(`Incoming WhatsApp message from ${message.from}: ${message.text}`);
      const result = await this.dialogService.process({
        channel: "whatsapp",
        externalUserId: message.from,
        text: message.text,
      });
      await this.sendTextMessage(message.from, result.replyText);
    }
  }

  async sendTextMessage(to: string, body: string): Promise<void> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      this.logger.warn("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set");
      return;
    }

    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`WhatsApp send failed: ${response.status} ${errText}`);
    }
  }
}
