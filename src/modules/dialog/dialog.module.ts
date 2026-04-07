import { Module } from "@nestjs/common";
import { DialogService } from "./dialog.service";

@Module({
  providers: [DialogService],
  exports: [DialogService],
})
export class DialogModule {}
