import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { ROLE_PERMISSIONS } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, SignupDto, OtpRequestDto, OtpVerifyDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const slug = dto.businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const permissions = ROLE_PERMISSIONS.ADMIN;

    const business = await this.prisma.business.create({
      data: {
        name: dto.businessName,
        slug: `${slug}-${Date.now().toString(36)}`,
        email: dto.email,
        phone: dto.phone,
        branches: {
          create: {
            name: 'Main Store',
            code: 'MAIN',
            type: 'SHOP',
            isDefault: true,
          },
        },
        users: {
          create: {
            email: dto.email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            role: 'ADMIN',
            permissions,
          },
        },
      },
      include: { branches: true, users: true },
    });

    const user = business.users[0];
    const branch = business.branches[0];

    await this.prisma.warehouse.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        name: 'Main Store Warehouse',
        code: 'WH-MAIN',
      },
    });

    await this.prisma.bankAccount.create({
      data: {
        businessId: business.id,
        name: 'Cash in Hand',
        accountType: 'CASH',
        balance: 0,
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { branchId: branch.id },
    });

    return this.issueTokens(user.id, user.email, business.id, branch.id, user.role, permissions);
  }

  async login(dto: LoginDto, ip?: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.isLocked) throw new UnauthorizedException('Account locked');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: attempts,
          isLocked: attempts >= 5,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lastLoginAt: new Date() },
    });

    return this.issueTokens(
      user.id,
      user.email,
      user.businessId,
      user.branchId ?? undefined,
      user.role,
      ROLE_PERMISSIONS[user.role] ?? [],
      dto.deviceInfo,
      ip,
    );
  }

  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = session.user;
    return this.issueTokens(
      user.id,
      user.email,
      user.businessId,
      user.branchId ?? undefined,
      user.role,
      ROLE_PERMISSIONS[user.role] ?? [],
    );
  }

  async requestOtp(dto: OtpRequestDto) {
    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!user) throw new BadRequestException('User not found');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.otpCode.create({ data: { email: dto.email, code, expiresAt } });
    console.log(`[OTP] ${dto.email}: ${code}`);
    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(dto: OtpVerifyDto) {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        email: dto.email,
        code: dto.code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('Invalid or expired OTP');

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

    const user = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException();

    return this.issueTokens(
      user.id,
      user.email,
      user.businessId,
      user.branchId ?? undefined,
      user.role,
      ROLE_PERMISSIONS[user.role] ?? [],
    );
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { email, code, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('Invalid or expired code');

    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, failedAttempts: 0, isLocked: false } }),
      this.prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    return { message: 'Password reset successful' };
  }

  async getSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      select: { id: true, deviceInfo: true, ipAddress: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
    return { message: 'Session revoked' };
  }

  async logout(refreshToken: string) {
    await this.prisma.session.deleteMany({ where: { refreshToken } });
    return { message: 'Logged out' };
  }

  private async issueTokens(
    userId: string,
    email: string,
    businessId: string,
    branchId: string | undefined,
    role: string,
    permissions: string[],
    deviceInfo?: string,
    ip?: string,
  ) {
    const payload = { sub: userId, email, businessId, branchId, role, permissions };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: { userId, refreshToken, deviceInfo, ipAddress: ip, expiresAt },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: userId, email, businessId, branchId, role, permissions },
    };
  }
}
