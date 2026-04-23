import { SetMetadata } from "@nestjs/common";
import { AdminRole } from "@prisma/client";

export const ROLES_KEY = "admin_roles";

export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
