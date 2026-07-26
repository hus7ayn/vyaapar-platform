import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import {
  LoginDto,
  SignupDto,
  RefreshTokenDto,
  OtpRequestDto,
  OtpVerifyDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

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

  @Public()
  @Post('otp/request')
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto);
  }

  @Public()
  @Post('otp/verify')
  verifyOtp(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto);
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestOtp({ email: dto.email });
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.email, dto.roleKey, dto.newPassword);
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
