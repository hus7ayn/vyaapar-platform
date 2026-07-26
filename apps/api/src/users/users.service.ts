import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Permission, ROLE_PERMISSIONS, SystemRole } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

// Business-wide roles (SUPER_ADMIN, and anything holding BUSINESS_MANAGE like
// HOTEL_OWNER/ADMIN) are never assignable through this tenant-scoped endpoint —
// a business owner is only ever created by a platform super admin (see
// PlatformService.createTenant) or at signup, never by another tenant user.
const STAFF_ASSIGNABLE_ROLES: string[] = Object.values(SystemRole).filter(
  (r) => r !== SystemRole.SUPER_ADMIN && !(ROLE_PERMISSIONS[r] ?? []).includes(Permission.BUSINESS_MANAGE),
);

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll(businessId: string, branchId?: string) {
    return this.prisma.user.findMany({
      where: { businessId, deletedAt: null, ...(branchId ? { branchId } : {}) },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        branchId: true,
        lastLoginAt: true,
      },
    });
  }

  async create(
    businessId: string,
    data: CreateUserDto,
    callerBranchId?: string,
  ) {
    if (!STAFF_ASSIGNABLE_ROLES.includes(data.role)) {
      throw new BadRequestException('Invalid role');
    }
    const permissions = ROLE_PERMISSIONS[data.role] ?? [];
    // A branch-locked caller (shop admin, not a business-wide owner) can only
    // ever create staff within their own branch — ignore any other branchId
    // they might pass, rather than trusting client input.
    const targetBranchId = callerBranchId ?? data.branchId;
    // Every assignable role here is shop-scoped (business-wide roles are
    // excluded above), so it must be pinned to one branch — otherwise
    // branch-scoping silently falls back to "see all branches".
    if (!targetBranchId) throw new BadRequestException('This role must be assigned to a specific shop/branch');
    const branch = await this.prisma.branch.findFirst({ where: { id: targetBranchId, businessId } });
    if (!branch) throw new NotFoundException('Branch not found');
    const passwordHash = await bcrypt.hash(data.password, 12);
    return this.prisma.user.create({
      data: {
        businessId,
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        branchId: targetBranchId,
        permissions,
      },
    });
  }

  private readonly staffSelect = {
    id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, branchId: true, lastLoginAt: true,
  } as const;

  // A manageable target must be in the same business, not soft-deleted, and NOT a business
  // owner / platform super admin — those are never editable through this tenant endpoint.
  private async assertManageable(businessId: string, id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, businessId, deletedAt: null } });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === SystemRole.SUPER_ADMIN || (ROLE_PERMISSIONS[target.role] ?? []).includes(Permission.BUSINESS_MANAGE)) {
      throw new ForbiddenException('Owner accounts cannot be modified here');
    }
    return target;
  }

  async update(businessId: string, id: string, data: { firstName?: string; lastName?: string; role?: string; branchId?: string }) {
    const target = await this.assertManageable(businessId, id);
    if (data.role && !STAFF_ASSIGNABLE_ROLES.includes(data.role)) throw new BadRequestException('Invalid role');
    if (data.branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: data.branchId, businessId } });
      if (!branch) throw new NotFoundException('Branch not found');
    }
    return this.prisma.user.update({
      where: { id: target.id },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.role && { role: data.role, permissions: ROLE_PERMISSIONS[data.role] ?? [] }),
        ...(data.branchId && { branchId: data.branchId }),
      },
      select: this.staffSelect,
    });
  }

  async setActive(businessId: string, id: string, isActive: boolean, callerId: string) {
    if (id === callerId) throw new BadRequestException('You cannot change your own status');
    const target = await this.assertManageable(businessId, id);
    // Disabling takes effect on the target's next request (jwt.strategy re-checks isActive).
    return this.prisma.user.update({ where: { id: target.id }, data: { isActive }, select: this.staffSelect });
  }

  async remove(businessId: string, id: string, callerId: string) {
    if (id === callerId) throw new BadRequestException('You cannot delete your own account');
    const target = await this.assertManageable(businessId, id);
    await this.prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date(), isActive: false } });
    return { id: target.id, deleted: true };
  }
}
