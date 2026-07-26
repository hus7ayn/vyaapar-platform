import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/is-strong-password.decorator';

export class LoginDto {
  @IsEmail()
  email: string;

  // Intentionally just a sanity check, not the full strength policy — existing
  // accounts predate that rule and shouldn't be rejected at login time.
  @IsString()
  @MinLength(1)
  password: string;

  @IsOptional()
  @IsString()
  deviceInfo?: string;
}

export class SignupDto {
  @IsString()
  businessName: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsStrongPassword()
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class OtpRequestDto {
  @IsEmail()
  email: string;
}

export class OtpVerifyDto {
  @IsEmail()
  email: string;

  @IsString()
  code: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  // Role-specific reset key (Super Admin / Admin / Biller key) — replaces email OTP.
  @IsString()
  roleKey: string;

  @IsString()
  @IsStrongPassword()
  newPassword: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @IsStrongPassword()
  newPassword: string;
}
