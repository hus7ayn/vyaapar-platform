import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RefreshTokenDto,
  ConfirmEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // Public self-service signup has been removed — accounts are created only by an admin from the
  // Staff/Users panel (POST /users, guarded by USER_MANAGE). There is intentionally no public
  // account-creation route.

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.ip);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // There is deliberately no otp/request or otp/verify route. They used to mint a full session
  // for ANY role straight from an emailed code — a passwordless login nothing in the product
  // asked for. forgot-password below is the only way to obtain a code, and it can only be
  // spent on a password reset.

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3600_000 } }) // tight: this one sends mail to a real inbox
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 3600_000 } }) // enough retries for a mistyped code, not for guessing
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPasswordWithCode(dto.email, dto.code, dto.newPassword);
  }

  @ApiBearerAuth()
  @Get('verify-email/status')
  verificationStatus(@CurrentUser('sub') userId: string) {
    return this.auth.verificationStatus(userId);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  @Post('verify-email/resend')
  resendVerification(@CurrentUser('sub') userId: string) {
    return this.auth.resendVerificationEmail(userId);
  }

  @Public()
  @Post('verify-email/confirm')
  confirmEmail(@Body() dto: ConfirmEmailDto) {
    return this.auth.confirmEmail(dto.token);
  }

  @ApiBearerAuth()
  @Post('change-password')
  changePassword(@CurrentUser('sub') userId: string, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser('sub') userId: string) {
    return this.auth.getSessions(userId);
  }

  @ApiBearerAuth()
  @Post('sessions/:id/revoke')
  revokeSession(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.auth.revokeSession(userId, id);
  }

  @ApiBearerAuth()
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
