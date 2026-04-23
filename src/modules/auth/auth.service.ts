import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AdminRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { JWT_ACCESS, JWT_REFRESH } from "./auth.constants";
import type { AdminJwtPayload } from "./jwt.strategy";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid credentials");
    }
    return this.issueTokens(user.id, user.role);
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const secret =
      process.env.JWT_REFRESH_SECRET?.trim() ||
      (process.env.NODE_ENV !== "production" ? "dev-admin-refresh-secret-change-me" : "");
    if (!secret) {
      throw new UnauthorizedException();
    }
    let payload: { sub: string; typ: string; role: AdminRole };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, { secret });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (payload.typ !== JWT_REFRESH || !payload.sub) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    const user = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    const hash = this.hashRefreshToken(refreshToken);
    if (hash !== user.refreshTokenHash) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    return this.issueTokens(user.id, user.role);
  }

  private async issueTokens(userId: string, role: AdminRole): Promise<{ accessToken: string; refreshToken: string }> {
    const accessSecret =
      process.env.JWT_ACCESS_SECRET?.trim() ||
      (process.env.NODE_ENV !== "production" ? "dev-admin-jwt-secret-change-me" : "");
    const refreshSecret =
      process.env.JWT_REFRESH_SECRET?.trim() ||
      (process.env.NODE_ENV !== "production" ? "dev-admin-refresh-secret-change-me" : "");
    if (!accessSecret || !refreshSecret) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production");
    }

    const accessTtl = process.env.JWT_ACCESS_EXPIRES_IN?.trim() || "15m";
    const refreshTtl = process.env.JWT_REFRESH_EXPIRES_IN?.trim() || "7d";

    const accessPayload: AdminJwtPayload = { sub: userId, role, typ: JWT_ACCESS };
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: accessSecret,
      expiresIn: accessTtl,
    } as Parameters<JwtService["signAsync"]>[1]);

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, role, typ: JWT_REFRESH, jti: randomBytes(16).toString("hex") },
      { secret: refreshSecret, expiresIn: refreshTtl } as Parameters<JwtService["signAsync"]>[1],
    );

    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });

    return { accessToken, refreshToken };
  }

  private hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
