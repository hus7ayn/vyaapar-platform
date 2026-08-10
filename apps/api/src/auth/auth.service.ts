import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { ROLE_PERMISSIONS, SystemRole } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { resetCodeEmail, verifyAddressEmail } from '../mail/templates';
import { LoginDto, SignupDto } from './dto/auth.dto';

/**
 * Roles with nobody above them, so the system itself has to let them back in. Note the naming:
 * ADMIN is the business owner the UI labels "Super Admin"; SUPER_ADMIN is the platform admin.
 * Every other role is reset by the owner from the Users screen — see docs/plans/account-email-recovery.
 */
export const SELF_RESET_ROLES: readonly string[] = [SystemRole.ADMIN, SystemRole.SUPER_ADMIN];

/**
 * The only thing forgot-password ever says. Identical for an unknown address, an ineligible role
 * and a successful send, so the endpoint can't be used to discover which accounts exist.
 */
export const GENERIC_RESET_REPLY =
  'If that email is registered, a six-digit reset code is on its way. '
  + 'Enter it on the next screen to set a new password.';

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 10;

/** Keeps a reset code from ever being spent by some future OTP flow. */
const OTP_PURPOSE_RESET = 'PASSWORD_RESET';

const VERIFY_TOKEN_EXPIRY_HOURS = 24;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mail: MailService,
  ) {}

  /**
   * Emails a reset code to every self-reset account on this address — one per account, because
   * the same address can own accounts in two businesses and each code may only change its own.
   * The reply never varies, so this can't be used to discover which accounts exist.
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    // Every registered user can recover their own account by email — a standard forgot-password
    // flow for all roles (biller, cashier, accountant, admin…), not just the owner. One code is
    // created per account on this address, since the same email can own accounts in more than one
    // business. (An admin can still set a staff password manually from the Users screen as a
    // fallback for accounts with no/incorrect email.)
    const users = await this.prisma.user.findMany({
      where: { email, deletedAt: null },
      include: { business: true },
    });

    for (const user of users) {
      const code = AuthService.generateOtpCode();
      await this.prisma.otpCode.create({
        data: {
          userId: user.id,
          email: user.email,
          code,
          purpose: OTP_PURPOSE_RESET,
          expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000),
        },
      });
      await this.mail.send({
        to: user.email,
        ...resetCodeEmail({
          firstName: user.firstName,
          businessName: user.business.name,
          code,
          expiresInMinutes: OTP_EXPIRY_MINUTES,
        }),
      });
    }

    return { message: GENERIC_RESET_REPLY };
  }

  /** Spends the code, sets the password, drops every session, and signs them straight in. */
  async resetPasswordWithCode(email: string, code: string, newPassword: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        code,
        used: false,
        purpose: OTP_PURPOSE_RESET,
        expiresAt: { gt: new Date() },
        user: { email, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { include: { business: true } } },
    });
    // One message for wrong, expired and already-spent alike — none of them should tell an
    // attacker which of the three it was. (otp.user is nullable in the type because the FK column
    // is nullable, but the query filters on the relation, so a matched row always has a user.)
    if (!otp || !otp.user) throw new UnauthorizedException('Invalid or expired code');

    // Checked before the code is spent, so a disabled account doesn't burn its own code.
    this.assertLoginAllowed(otp.user);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // otp.user is guaranteed non-null here (the query filters on the `user` relation), so use its
    // id rather than the now-nullable otp.userId column.
    const targetUserId = otp.user.id;
    await this.prisma.$transaction([
      this.prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } }),
      this.prisma.user.update({
        where: { id: targetUserId },
        data: {
          passwordHash,
          failedAttempts: 0,
          isLocked: false,
          // Receiving the code is itself proof the address reaches them.
          emailVerifiedAt: otp.user.emailVerifiedAt ?? new Date(),
        },
      }),
      this.prisma.session.deleteMany({ where: { userId: targetUserId } }),
    ]);

    return this.issueTokens(
      otp.user.id,
      otp.user.email,
      otp.user.businessId,
      otp.user.branchId ?? undefined,
      otp.user.role,
      ROLE_PERMISSIONS[otp.user.role] ?? [],
    );
  }

  /** Six digits from a real random source, padded so a leading zero survives. */
  static generateOtpCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /** The raw token goes in the link; only its hash is ever stored. */
  static generateVerificationToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, tokenHash: AuthService.hashToken(token) };
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Re-sends the confirmation link for the caller's own address. Only self-reset roles have an
   * address worth confirming — nothing is ever emailed to staff.
   */
  async resendVerificationEmail(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { business: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (!SELF_RESET_ROLES.includes(user.role)) {
      throw new BadRequestException('Only a Super Admin has a recovery address to confirm');
    }
    if (user.emailVerifiedAt) return { message: 'That address is already confirmed' };

    const { token, tokenHash } = AuthService.generateVerificationToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_EXPIRY_HOURS * 3600_000),
      },
    });

    const base = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');
    await this.mail.send({
      to: user.email,
      ...verifyAddressEmail({
        firstName: user.firstName,
        businessName: user.business.name,
        link: `${base}/verify-email?token=${token}`,
        expiresInHours: VERIFY_TOKEN_EXPIRY_HOURS,
      }),
    });

    return { message: 'Confirmation email sent' };
  }

  /**
   * What the account screen needs to decide whether to nag. `required` is false for staff — their
   * address is only a label, since nothing is ever emailed to them.
   */
  async verificationStatus(userId: string): Promise<{ required: boolean; verified: boolean; email: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true, role: true, emailVerifiedAt: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return {
      required: SELF_RESET_ROLES.includes(user.role),
      verified: user.emailVerifiedAt != null,
      email: user.email,
    };
  }

  /** Spends a confirmation link. */
  async confirmEmail(token: string): Promise<{ message: string }> {
    const row = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: AuthService.hashToken(token) },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('That confirmation link is invalid or has expired');
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    return { message: 'Email confirmed' };
  }

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
      include: { business: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('This account has been disabled');
    if (!user.isApproved) throw new UnauthorizedException('Your account is awaiting Super Admin approval');
    if (user.isLocked) throw new UnauthorizedException('Account locked');
    if (!user.business.isActive) throw new UnauthorizedException('Business account suspended');

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
      include: { user: { include: { business: true } } },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = session.user;
    if (user.deletedAt) throw new UnauthorizedException('Invalid refresh token');
    this.assertLoginAllowed(user);
    return this.issueTokens(
      user.id,
      user.email,
      user.businessId,
      user.branchId ?? undefined,
      user.role,
      ROLE_PERMISSIONS[user.role] ?? [],
    );
  }

  // requestOtp / verifyOtp used to live here. verifyOtp minted a full session for any role
  // straight from an emailed code — a passwordless login the product never asked for, harmless
  // only because the code was written to a log and never delivered. Now that mail actually goes
  // out, they are gone; forgotPassword above is the only source of a code and it can only be
  // spent on a password reset.

  // Shared gate for every path that mints tokens (login, password reset, refresh) so a
  // disabled / unapproved / locked account (or a suspended business) can never obtain
  // usable tokens by any route.
  private assertLoginAllowed(user: { isActive: boolean; isApproved: boolean; isLocked: boolean; business?: { isActive: boolean } }) {
    if (!user.isActive) throw new UnauthorizedException('This account has been disabled');
    if (!user.isApproved) throw new UnauthorizedException('Your account is awaiting Super Admin approval');
    if (user.isLocked) throw new UnauthorizedException('Account locked');
    if (user.business && !user.business.isActive) throw new UnauthorizedException('Business account suspended');
  }

  // resetKeyForRole and the key-based resetPassword used to live here: one shared secret per
  // role, held in env, identical for every user in that role and never rotated. An emailed
  // one-time code bound to a single account replaces it — see resetPasswordWithCode above.

  // Authenticated change-password: verify the current password, then update. Invalidates all
  // sessions (refresh tokens) so a stolen refresh token can't survive a password change.
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('User not found');
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
    return { message: 'Password changed successfully' };
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
