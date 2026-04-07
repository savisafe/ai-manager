import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { TelegramService } from "./telegram.service";
import { TelegramWebhookPayload } from "./telegram.types";

@Controller("webhooks/telegram")
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Get("health")
  health() {
    return { status: "ok", channel: "telegram" };
  }

  @Post()
  @HttpCode(200)
  async webhook(@Body() payload: TelegramWebhookPayload) {
    await this.telegramService.handleIncoming(payload);
    return { ok: true };
  }
}
