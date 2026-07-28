import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BusinessesService {
  constructor(private prisma: PrismaService) {}

  getProfile(businessId: string) {
    return this.prisma.business.findUnique({
      where: { id: businessId },
      // Never surface soft-deleted shops in the profile (they're removed from every list/dropdown).
      include: { branches: { where: { deletedAt: null } } },
    });
  }

  update(businessId: string, data: Record<string, unknown>) {
    const ALLOWED_FIELDS = ['name', 'phone', 'address', 'gstNumber', 'state', 'logoUrl', 'currency', 'timezone'] as const;
    const update: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (data[field] !== undefined) update[field] = data[field];
    }
    // The business name prints on every receipt — never let it be blanked or set to a non-string.
    if ('name' in update) {
      if (typeof update.name !== 'string' || !update.name.trim()) {
        throw new BadRequestException('Business name is required');
      }
      update.name = update.name.trim();
    }
    return this.prisma.business.update({ where: { id: businessId }, data: update });
  }
}
