import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AdminRole } from "@prisma/client";
import { JWT_ACCESS } from "./auth.constants";

export interface AdminJwtPayload {
  sub: string;
  role: AdminRole;
  typ: typeof JWT_ACCESS;
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, JWT_ACCESS) {
  constructor() {
    const secret =
      process.env.JWT_ACCESS_SECRET?.trim() ||
      (process.env.NODE_ENV !== "production" ? "dev-admin-jwt-secret-change-me" : "");
    if (!secret) {
      throw new Error("JWT_ACCESS_SECRET is required for AdminJwtStrategy in production");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: AdminJwtPayload): AdminJwtPayload {
    if (!payload?.sub || payload.typ !== JWT_ACCESS) {
      throw new UnauthorizedException();
    }
    return payload;
  }
}
