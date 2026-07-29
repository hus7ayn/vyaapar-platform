import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Permission, ROLE_PERMISSIONS, SystemRole } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

// Business-wide roles (SUPER_ADMIN, and anything holding BUSINESS_MANAGE like
// ADMIN) are never assignable through this tenant-scoped endpoint —
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
        isApproved: true,
        approvedAt: true,
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
        // New staff start PENDING — a Super Admin must approve before they can access.
        isApproved: false,
      },
    });
  }

  private readonly staffSelect = {
    id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, isApproved: true, approvedAt: true, branchId: true, lastLoginAt: true,
  } as const;

  // Super Admin approves a pending staff account so it can sign in. Gated to owners
  // (BUSINESS_MANAGE) at the controller — shop admins cannot approve.
  async approve(businessId: string, id: string, approverId: string) {
    const target = await this.assertManageable(businessId, id);
    return this.prisma.user.update({
      where: { id: target.id },
      data: { isApproved: true, approvedAt: new Date(), approvedById: approverId },
      select: this.staffSelect,
    });
  }

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
    const updated = await this.prisma.user.update({ where: { id: target.id }, data: { isActive }, select: this.staffSelect });
    // Disabling also revokes every session/refresh token immediately (jwt.strategy re-checks
    // isActive per request, but killing the rows means no lingering token can even be refreshed).
    if (!isActive) await this.prisma.session.deleteMany({ where: { userId: target.id } });
    return updated;
  }

  async remove(businessId: string, id: string, callerId: string) {
    if (id === callerId) throw new BadRequestException('You cannot delete your own account');
    const target = await this.assertManageable(businessId, id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date(), isActive: false } }),
      // Revoke tokens and clear any pending OTP login codes so they can't authenticate at all.
      this.prisma.session.deleteMany({ where: { userId: target.id } }),
      this.prisma.otpCode.deleteMany({ where: { email: target.email } }),
    ]);
    return { id: target.id, deleted: true };
  }

  /**
   * Permanently remove EVERY user in the business except the caller (the Super Admin running it).
   * Hard delete is safe here: sessions cascade-delete (onDelete: Cascade) and the only other FKs to
   * User (txn.createdById, auditLog.userId, task assignees) are optional and set-null on delete, so
   * no orphaned rows or FK violations, and transaction history is preserved (attribution nulled).
   * Also clears email OTP codes so removed accounts have zero cached auth. Keeps ONLY the caller, so
   * it can never lock the owner out. Gated to BUSINESS_MANAGE at the controller.
   */
  async purgeOthers(businessId: string, callerId: string) {
    const caller = await this.prisma.user.findFirst({ where: { id: callerId, businessId, deletedAt: null } });
    if (!caller) throw new NotFoundException('Your account was not found');

    const others = await this.prisma.user.findMany({
      where: { businessId, id: { not: callerId } },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    if (!others.length) {
      return { removed: 0, kept: { id: caller.id, email: caller.email, role: caller.role }, removedAccounts: [] };
    }

    const emails = others.map((u) => u.email);
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.otpCode.deleteMany({ where: { email: { in: emails } } });
      // sessions/tokens are removed by the ON DELETE CASCADE on Session.userId.
      const del = await tx.user.deleteMany({ where: { businessId, id: { not: callerId } } });
      return del.count;
    });

    return {
      removed,
      kept: { id: caller.id, email: caller.email, role: caller.role },
      removedAccounts: others.map((u) => ({ email: u.email, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role })),
    };
  }
}
