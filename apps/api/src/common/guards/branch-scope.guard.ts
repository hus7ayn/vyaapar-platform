import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtPayload, Permission } from '@nexus/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolves the effective branch for every authenticated request — always, not
 * only when a header is sent, since `branchWhere()` treats an undefined
 * branchId as "no filter" (i.e. all branches). Only BUSINESS_MANAGE holders
 * (the business-wide owner: ADMIN/SUPER_ADMIN) may operate across
 * branches via the x-branch-id header ("switch shop"). Every other role
 * (BRANCH_MANAGER, accountant, etc.)
 * is locked to their own assigned branch and denied if none is assigned,
 * rather than silently falling back to "see everything". Sets
 * request.resolvedBranchId for CurrentUser('branchId').
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user) return true;

    const headerBranchId = request.headers['x-branch-id'];
    const canSwitchBranches = user.permissions?.includes(Permission.BUSINESS_MANAGE);

    if (canSwitchBranches) {
      if (headerBranchId && typeof headerBranchId === 'string') {
        const branch = await this.prisma.branch.findFirst({
          where: { id: headerBranchId, businessId: user.businessId },
        });
        if (!branch) throw new ForbiddenException('Invalid branch');
        request.resolvedBranchId = headerBranchId;
      } else {
        request.resolvedBranchId = user.branchId ?? undefined;
      }
      return true;
    }

    if (!user.branchId) {
      throw new ForbiddenException('No branch assigned to this account — contact your admin');
    }
    request.resolvedBranchId = user.branchId;
    return true;
  }
}
