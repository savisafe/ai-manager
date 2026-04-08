import { Module } from "@nestjs/common";
import { PromptProfileModule } from "../prompt-profile/prompt-profile.module";
import { DialogService } from "./dialog.service";

@Module({
  imports: [PromptProfileModule],
  providers: [DialogService],
  exports: [DialogService],
})
export class DialogModule {}
