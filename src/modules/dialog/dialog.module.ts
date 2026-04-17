import { Module } from "@nestjs/common";
import { PromptProfileModule } from "../prompt-profile/prompt-profile.module";
import { RagModule } from "../rag/rag.module";
import { DialogService } from "./dialog.service";

@Module({
  imports: [PromptProfileModule, RagModule],
  providers: [DialogService],
  exports: [DialogService],
})
export class DialogModule {}
