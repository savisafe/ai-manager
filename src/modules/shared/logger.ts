import { ConsoleLogger } from "@nestjs/common";

export class Logger extends ConsoleLogger {
  constructor() {
    super("AIManager");
  }
}
