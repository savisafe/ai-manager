import { Module } from "@nestjs/common";
import { DialogModule } from "./dialog/dialog.module";
import { HealthModule } from "./health/health.module";
import { IdempotencyModule } from "./idempotency/idempotency.module";
import { LlmModule } from "./llm/llm.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TelegramModule } from "./telegram/telegram.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";

@Module({
  imports: [
    PrismaModule,
    IdempotencyModule,
    LlmModule,
    DialogModule,
    HealthModule,
    WhatsAppModule,
    TelegramModule,
  ],
})
export class AppModule {}
