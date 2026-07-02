import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@nexus/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    if (data === 'branchId') {
      const headerBranchId = request.headers['x-branch-id'];
      if (headerBranchId) return headerBranchId as string;
      return user?.branchId;
    }

    return data ? user?.[data] : user;
  },
);
