import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, ROLE_PERMISSIONS } from '@nexus/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LOGIN_ERRORS, loginRefusalReason } from '../login-refusal';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Fetch on identity alone, then judge the state separately — the account-state filters used
    // to live in the WHERE clause, so a deactivated, unapproved or locked user was
    // indistinguishable from a deleted one and every case came back as a blank 401. The same
    // gate as login now decides, so the reason survives into the response and the logs.
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      include: { business: true },
    });
    if (!user) throw new UnauthorizedException(LOGIN_ERRORS.INVALID);
    const refusal = loginRefusalReason(user);
    if (refusal) throw new UnauthorizedException(refusal);
    return {
      sub: user.id,
      email: user.email,
      businessId: user.businessId,
      branchId: user.branchId ?? undefined,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role] ?? [],
    };
  }
}
