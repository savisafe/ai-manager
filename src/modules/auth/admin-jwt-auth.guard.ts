import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { JWT_ACCESS } from "./auth.constants";

@Injectable()
export class AdminJwtAuthGuard extends AuthGuard(JWT_ACCESS) {}
