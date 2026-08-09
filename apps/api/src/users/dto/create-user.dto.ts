import { IsEmail, IsOptional, IsString } from 'class-validator';
import { IsStrongPassword } from '../../common/validators/is-strong-password.decorator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsStrongPassword()
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  role: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}

export class SetUserPasswordDto {
  @IsString()
  @IsStrongPassword()
  newPassword: string;
}
