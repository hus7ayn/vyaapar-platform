import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
}
