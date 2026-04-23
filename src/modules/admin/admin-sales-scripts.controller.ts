import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AdminRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { AdminJwtAuthGuard } from "../auth/admin-jwt-auth.guard";
import { AdminRolesGuard } from "../auth/roles.guard";
import { AdminRoles } from "../auth/roles.decorator";
import { ConfigManagementService } from "../config-management/config-management.service";

const createSchema = z.object({
  slug: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  version: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

const patchSchema = z.object({
  slug: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

@Controller("admin/scripts")
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.ADMIN, AdminRole.MANAGER)
export class AdminSalesScriptsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configManagement: ConfigManagementService,
  ) {}

  @Get()
  async list() {
    return this.prisma.salesScript.findMany({ orderBy: { updatedAt: "desc" } });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const row = await this.prisma.salesScript.findFirst({
      where: { OR: [{ id }, { slug: id }] },
    });
    if (!row) {
      throw new NotFoundException();
    }
    return row;
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const row = await this.prisma.salesScript.create({
      data: {
        slug: parsed.data.slug,
        data: parsed.data.data as Prisma.InputJsonValue,
        version: parsed.data.version ?? 1,
        isActive: parsed.data.isActive ?? false,
      },
    });
    this.configManagement.invalidateAll();
    return row;
  }

  @Patch(":id")
  async patch(@Param("id") id: string, @Body() body: unknown) {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const existing = await this.prisma.salesScript.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException();
    }
    const row = await this.prisma.salesScript.update({
      where: { id },
      data: {
        slug: parsed.data.slug,
        data: parsed.data.data === undefined ? undefined : (parsed.data.data as Prisma.InputJsonValue),
        version: parsed.data.version,
        isActive: parsed.data.isActive,
      },
    });
    this.configManagement.invalidateAll();
    return row;
  }

  @Delete(":id")
  @AdminRoles(AdminRole.ADMIN)
  async remove(@Param("id") id: string) {
    await this.prisma.salesScript.delete({ where: { id } }).catch(() => {
      throw new NotFoundException();
    });
    this.configManagement.invalidateAll();
    return { ok: true };
  }
}
