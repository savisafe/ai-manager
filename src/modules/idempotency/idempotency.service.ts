import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async tryProcess(channel: string, externalMessageId?: string): Promise<boolean> {
    if (!externalMessageId) {
      return true;
    }

    try {
      await this.prisma.processedInboundMessage.create({
        data: { channel, externalMessageId },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return false;
      }
      throw error;
    }
  }
}
