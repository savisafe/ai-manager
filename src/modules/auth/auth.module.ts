import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AdminJwtStrategy } from "./jwt.strategy";

@Module({
  imports: [PrismaModule, PassportModule.register({ defaultStrategy: undefined }), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AdminJwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
