import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@nexus/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    if (data === 'branchId') {
      return request.resolvedBranchId as string | undefined;
    }

    return data ? user?.[data] : user;
  },
);
