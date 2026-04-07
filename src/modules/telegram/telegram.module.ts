import { Module } from "@nestjs/common";
import { DialogModule } from "../dialog/dialog.module";
import { TelegramController } from "./telegram.controller";
import { TelegramService } from "./telegram.service";

@Module({
  imports: [DialogModule],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
