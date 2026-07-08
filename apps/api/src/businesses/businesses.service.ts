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
    const ALLOWED_FIELDS = ['name', 'phone', 'address', 'gstNumber', 'state', 'logoUrl', 'currency', 'timezone'] as const;
    const update: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (data[field] !== undefined) update[field] = data[field];
    }
    return this.prisma.business.update({ where: { id: businessId }, data: update });
  }
}
