import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("admin/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    const email = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "");
    if (!email || !password) {
      throw new BadRequestException("email and password are required");
    }
    return this.authService.login(email, password);
  }

  @Post("refresh")
  async refresh(@Body() body: { refreshToken: string }) {
    const refreshToken = String(body?.refreshToken ?? "").trim();
    if (!refreshToken) {
      throw new BadRequestException("refreshToken is required");
    }
    return this.authService.refresh(refreshToken);
  }
}
