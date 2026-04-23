import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminRole } from "@prisma/client";
import { ROLES_KEY } from "./roles.decorator";
import type { AdminJwtPayload } from "./jwt.strategy";

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<{ user?: AdminJwtPayload }>();
    const role = req.user?.role;
    if (!role) {
      return false;
    }
    return required.includes(role);
  }
}
