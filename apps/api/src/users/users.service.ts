import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
      select: this.staffSelect,
    });
  }

  /**
   * An admin adds a staff member from the Users screen. The account must be usable the moment
   * this returns — the admin sets the password here and reads it out to the person in front of
   * them, so anything that leaves the row unusable turns into "I added a user and they can't
   * log in".
   *
   * Every state flag is therefore written EXPLICITLY rather than left to a schema default:
   * defaults are invisible at the call site, and this row is exactly the one that must not be
   * wrong. `isApproved` in particular used to be forced to false here, which meant every new
   * staff account was born unable to sign in — the admin who created it was the approval, so
   * that step only ever produced a support call.
   */
  async create(
    businessId: string,
    data: CreateUserDto,
    callerBranchId?: string,
    callerId?: string,
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

    // The address is only unique WITHIN a business, and a soft-deleted row still occupies that
    // slot — so re-adding someone who was removed used to fail on a raw unique-constraint error.
    // Case-insensitive, because login matches that way too and two rows differing only in case
    // would leave one of them permanently unreachable.
    const clashing = await this.prisma.user.findFirst({
      where: { businessId, email: { equals: data.email, mode: 'insensitive' } },
    });
    if (clashing && !clashing.deletedAt) {
      throw new ConflictException('Someone in this business already uses that email address');
    }
    // A removed OWNER account is never quietly reused as a staff row: reviving it here would
    // hand a shop admin a way to resurrect an account somebody deliberately took away.
    if (
      clashing
      && (clashing.role === SystemRole.SUPER_ADMIN
        || (ROLE_PERMISSIONS[clashing.role] ?? []).includes(Permission.BUSINESS_MANAGE))
    ) {
      throw new ConflictException('That email address belonged to an owner account — use a different one');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    // An admin with USER_MANAGE created this account; that IS the approval, so record it as one.
    const state = {
      isActive: true,
      isApproved: true,
      approvedAt: new Date(),
      ...(callerId ? { approvedById: callerId } : {}),
      // Nothing about a brand-new account is locked out or mid-way through a lockout.
      isLocked: false,
      failedAttempts: 0,
      deletedAt: null,
    };

    if (clashing) {
      // Removed before, added again: revive the existing row rather than orphaning the address.
      return this.prisma.user.update({
        where: { id: clashing.id },
        data: {
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
          branchId: targetBranchId,
          permissions,
          ...state,
        },
        select: this.staffSelect,
      });
    }

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
        ...state,
      },
      // Never the whole row: it carries passwordHash, which has no business leaving the server.
      select: this.staffSelect,
    });
  }

  // isLocked / failedAttempts are included so the Users screen can SHOW a lockout. Without them
  // an account locked by failed sign-ins looked completely healthy in the list while the person
  // was being turned away at the login form.
  private readonly staffSelect = {
    id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, isApproved: true, approvedAt: true, isLocked: true, failedAttempts: true, branchId: true, lastLoginAt: true,
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

  /**
   * Clears a lockout. Five wrong passwords lock an account, and until now nothing in the product
   * could undo that except setting a new password — so a staff member who fat-fingered their way
   * to five was simply stuck, and the owner had no button to press.
   *
   * This does not hand out access: the password is untouched, and every other gate (deactivated,
   * unapproved, soft-deleted, suspended business) still applies. It only resets the counter.
   */
  async unlock(businessId: string, id: string) {
    const target = await this.assertManageable(businessId, id);
    return this.prisma.user.update({
      where: { id: target.id },
      data: { isLocked: false, failedAttempts: 0 },
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

  /**
   * The Super Admin sets a staff member's password. Staff have no self-service reset, so this is
   * their only route back in — see docs/plans/account-email-recovery.
   */
  async setPassword(
    businessId: string,
    targetUserId: string,
    caller: { id: string; role: string },
    newPassword: string,
  ) {
    const callerIsOwner =
      caller.role === SystemRole.SUPER_ADMIN
      || (ROLE_PERMISSIONS[caller.role] ?? []).includes(Permission.BUSINESS_MANAGE);
    if (!callerIsOwner) {
      throw new ForbiddenException("Only a Super Admin can set another user's password");
    }
    if (targetUserId === caller.id) {
      throw new BadRequestException('Use Change password to change your own password');
    }
    // Same business, not deleted, and never another owner — one owner can't seize another's account.
    const target = await this.assertManageable(businessId, targetUserId);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: target.id },
        data: { passwordHash, failedAttempts: 0, isLocked: false },
      }),
      // Signed out everywhere: the old password has to stop working the moment it's replaced.
      this.prisma.session.deleteMany({ where: { userId: target.id } }),
      this.prisma.otpCode.deleteMany({ where: { userId: target.id } }),
    ]);

    return { id: target.id, message: 'Password updated' };
  }

  async remove(businessId: string, id: string, callerId: string) {
    if (id === callerId) throw new BadRequestException('You cannot delete your own account');
    const target = await this.assertManageable(businessId, id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date(), isActive: false } }),
      // Revoke tokens and clear any pending reset codes so they can't authenticate at all.
      // Keyed by userId, not email: the same address can own an account in another business
      // and deleting by email would cancel that account's codes too.
      this.prisma.session.deleteMany({ where: { userId: target.id } }),
      this.prisma.otpCode.deleteMany({ where: { userId: target.id } }),
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

    // By id, not email: an address here may also own an account in another business, whose
    // pending codes are none of this purge's business.
    const removedIds = others.map((u) => u.id);
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.otpCode.deleteMany({ where: { userId: { in: removedIds } } });
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
