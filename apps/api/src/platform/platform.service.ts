import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ROLE_PERMISSIONS } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/create-tenant.dto';
import { PaginationDto, paginateMeta } from '../common/dto/pagination.dto';

const PLATFORM_SLUG = 'nexus-platform';

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  private tenantWhere() {
    return { slug: { not: PLATFORM_SLUG }, deletedAt: null };
  }

  async getStats() {
    const [tenants, activeTenants, users, orders] = await Promise.all([
      this.prisma.business.count({ where: this.tenantWhere() }),
      this.prisma.business.count({ where: { ...this.tenantWhere(), isActive: true } }),
      this.prisma.user.count({
        where: { business: this.tenantWhere(), deletedAt: null },
      }),
      this.prisma.txn.count({
        where: { business: this.tenantWhere(), txnType: 'SALE_INVOICE' },
      }),
    ]);

    const recent = await this.prisma.business.findMany({
      where: this.tenantWhere(),
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true, txns: true } },
      },
    });

    return { tenants, activeTenants, users, orders, recentTenants: recent };
  }

  async listTenants(query: PaginationDto) {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const where = {
      ...this.tenantWhere(),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' as const } },
          { email: { contains: query.search, mode: 'insensitive' as const } },
          { slug: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          _count: { select: { users: true, branches: true, txns: true, items: true } },
        },
      }),
      this.prisma.business.count({ where }),
    ]);

    return { data, meta: paginateMeta(total, page, limit) };
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.business.findFirst({
      where: { id, ...this.tenantWhere() },
      include: {
        branches: { where: { deletedAt: null } },
        users: {
          where: { deletedAt: null },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        _count: { select: { txns: true, items: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async createTenant(dto: CreateTenantDto) {
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.user.findFirst({ where: { email: dto.adminEmail } });
          if (existing) throw new ConflictException('Admin email already in use');

          return tx.business.create({
            data: {
              name: dto.name,
              slug: `${slug}-${Date.now().toString(36)}`,
              email: dto.adminEmail,
              phone: dto.phone,
              gstNumber: dto.gstNumber,
              branches: {
                create: { name: 'Main Branch', code: 'MAIN', isDefault: true },
              },
              warehouses: {
                create: { name: 'Main Warehouse', code: 'WH-MAIN' },
              },
              users: {
                create: {
                  email: dto.adminEmail,
                  passwordHash,
                  firstName: dto.adminFirstName,
                  lastName: dto.adminLastName,
                  phone: dto.phone,
                  role: 'ADMIN',
                  permissions: ROLE_PERMISSIONS.ADMIN,
                },
              },
            },
            include: { branches: true, users: { select: { id: true, email: true, role: true } } },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      if ((err as { code?: string }).code === 'P2034') {
        throw new ConflictException('Admin email already in use');
      }
      throw err;
    }
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    await this.getTenant(id);
    return this.prisma.business.update({
      where: { id },
      data: dto,
    });
  }

  async listAuditLogs(query: PaginationDto) {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 50);
    const where = { business: this.tenantWhere() };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          business: { select: { name: true, slug: true } },
          user: { select: { email: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, meta: paginateMeta(total, page, limit) };
  }
}
