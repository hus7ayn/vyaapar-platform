import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, ROLE_PERMISSIONS } from '@nexus/shared';
import { PrismaService } from '../../prisma/prisma.service';

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
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
      include: { business: true },
    });
    if (!user || user.isLocked || !user.business.isActive) throw new UnauthorizedException();
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
