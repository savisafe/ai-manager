import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AdminJwtAuthGuard } from "../auth/admin-jwt-auth.guard";
import { AdminRolesGuard } from "../auth/roles.guard";
import { AdminRoles } from "../auth/roles.decorator";
import { AdminRole } from "@prisma/client";
import { AdminTestDialogService } from "./admin-test-dialog.service";

@Controller("admin")
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.ADMIN, AdminRole.MANAGER)
export class AdminTestDialogController {
  constructor(private readonly adminTestDialog: AdminTestDialogService) {}

  @Post("test-dialog")
  async testDialog(@Body() body: { message: string; configurationId: string }) {
    const message = String(body?.message ?? "").trim();
    const configurationId = String(body?.configurationId ?? "").trim();
    if (!message) {
      throw new BadRequestException("message is required");
    }
    if (!configurationId) {
      throw new BadRequestException("configurationId is required");
    }
    return this.adminTestDialog.run(message, configurationId);
  }
}
