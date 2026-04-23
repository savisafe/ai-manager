import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PromptProfileModule } from "../prompt-profile/prompt-profile.module";
import { ConfigManagementService } from "./config-management.service";

@Module({
  imports: [PrismaModule, PromptProfileModule],
  providers: [ConfigManagementService],
  exports: [ConfigManagementService],
})
export class ConfigManagementModule {}
