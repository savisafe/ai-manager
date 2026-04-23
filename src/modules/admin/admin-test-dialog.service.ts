import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ConfigManagementService } from "../config-management/config-management.service";
import { DialogService } from "../dialog/dialog.service";

@Injectable()
export class AdminTestDialogService {
  constructor(
    private readonly configManagement: ConfigManagementService,
    private readonly dialog: DialogService,
  ) {}

  async run(message: string, configurationId: string) {
    const bundle = await this.configManagement.resolveDialogResourceBundle(configurationId);
    const snapshot = this.dialog.composeSnapshot(bundle.sales, bundle.profile, bundle.bot);
    return this.dialog.runDiagnosticTurn(
      {
        channel: "telegram",
        externalUserId: `admin-test-${randomUUID()}`,
        text: message,
      },
      snapshot,
    );
  }
}
