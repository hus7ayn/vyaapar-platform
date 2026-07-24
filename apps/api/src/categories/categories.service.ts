import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  async create(businessId: string, branchId: string | undefined, data: { name: string; slug?: string; parentId?: string }) {
    const name = data.name?.trim();
    if (!name) throw new BadRequestException('Category name is required');

    // Auto-generate the slug from the name (clients no longer need to supply one)
    // and guarantee it's unique within (businessId, branchId) — the model has a
    // unique constraint on that triple, so a missing/duplicate slug used to throw
    // a raw Prisma error and make "add category" appear broken.
    const base =
      (data.slug?.trim() || name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'category';
    let slug = base;
    let n = 1;
    while (
      await this.prisma.category.findFirst({
        where: { businessId, branchId: branchId ?? null, slug },
        select: { id: true },
      })
    ) {
      slug = `${base}-${++n}`;
    }

    return this.prisma.category.create({
      data: { name, slug, parentId: data.parentId, businessId, branchId: branchId ?? null },
    });
  }

  async remove(businessId: string, id: string) {
    const existing = await this.prisma.category.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Category not found');
    return this.prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
