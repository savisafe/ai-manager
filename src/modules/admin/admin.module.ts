import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConfigManagementModule } from "../config-management/config-management.module";
import { DialogModule } from "../dialog/dialog.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminRolesGuard } from "../auth/roles.guard";
import { AdminConfigurationsController } from "./admin-configurations.controller";
import { AdminPromptProfilesController } from "./admin-prompt-profiles.controller";
import { AdminTestDialogController } from "./admin-test-dialog.controller";
import { AdminTestDialogService } from "./admin-test-dialog.service";

@Module({
  imports: [PrismaModule, AuthModule, ConfigManagementModule, DialogModule],
  controllers: [
    AdminConfigurationsController,
    AdminPromptProfilesController,
    AdminTestDialogController,
  ],
  providers: [AdminTestDialogService, AdminRolesGuard],
})
export class AdminModule {}
