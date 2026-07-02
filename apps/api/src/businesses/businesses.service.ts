import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BusinessesService {
  constructor(private prisma: PrismaService) {}

  getProfile(businessId: string) {
    return this.prisma.business.findUnique({
      where: { id: businessId },
      include: { branches: true },
    });
  }

  update(businessId: string, data: Record<string, unknown>) {
    return this.prisma.business.update({ where: { id: businessId }, data: data as never });
  }
}
