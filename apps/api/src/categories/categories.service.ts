import { Injectable } from '@nestjs/common';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  findAll(businessId: string, branchId?: string) {
    return this.prisma.category.findMany({
      where: { businessId, deletedAt: null, ...branchWhere(branchId) },
      orderBy: { sortOrder: 'asc' },
    });
  }

  create(businessId: string, branchId: string | undefined, data: { name: string; slug: string; parentId?: string }) {
    return this.prisma.category.create({
      data: { ...data, businessId, branchId: branchId ?? null },
    });
  }
}
