import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "ai-manager",
      timestamp: new Date().toISOString(),
    };
  }
}
