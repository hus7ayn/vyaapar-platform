import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UsersService } from './users.service';
import { CreateUserDto, SetUserPasswordDto } from './dto/create-user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USER_MANAGE)
  findAll(@CurrentUser('businessId') businessId: string, @CurrentUser('branchId') branchId?: string) {
    return this.users.findAll(businessId, branchId);
  }

  @Post()
  @RequirePermissions(Permission.USER_MANAGE)
  create(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @CurrentUser('sub') callerId: string,
    @Body() body: CreateUserDto,
  ) {
    // callerId is recorded as the approver: creating the account is the approval.
    return this.users.create(businessId, body, branchId, callerId);
  }

  // Permanently remove EVERY other user in the business, keeping only the Super Admin who calls
  // this. BUSINESS_MANAGE-gated (owner only) + explicit confirm so it can't fire by accident, and
  // it always keeps the caller so the owner can never be locked out. Declared before ':id' routes.
  @Post('purge-others')
  @RequirePermissions(Permission.BUSINESS_MANAGE)
  purgeOthers(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') callerId: string,
    @Body() body: { confirm?: boolean },
  ) {
    if (!body?.confirm) throw new BadRequestException('Confirmation required to remove all other users');
    return this.users.purgeOthers(businessId, callerId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USER_MANAGE)
  update(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { firstName?: string; lastName?: string; role?: string; branchId?: string },
  ) {
    return this.users.update(businessId, id, body);
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.USER_MANAGE)
  setStatus(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') callerId: string,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.users.setActive(businessId, id, !!body.isActive, callerId);
  }

  // Approval is Super Admin only (BUSINESS_MANAGE), not shop admins.
  @Patch(':id/approve')
  @RequirePermissions(Permission.BUSINESS_MANAGE)
  approve(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') approverId: string,
    @Param('id') id: string,
  ) {
    return this.users.approve(businessId, id, approverId);
  }

  // Clearing a lockout is USER_MANAGE, same as enabling/disabling — it grants no access on its
  // own (the password is untouched), so it does not need the stricter owner-only gate that
  // set-password below does.
  @Patch(':id/unlock')
  @RequirePermissions(Permission.USER_MANAGE)
  unlock(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.users.unlock(businessId, id);
  }

  // The other half of account recovery: staff have no self-service reset, so the Super Admin
  // sets their password here. See docs/plans/account-email-recovery.
  @Post(':id/set-password')
  @RequirePermissions(Permission.USER_MANAGE)
  setPassword(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') callerId: string,
    @CurrentUser('role') callerRole: string,
    @Param('id') id: string,
    @Body() body: SetUserPasswordDto,
  ) {
    return this.users.setPassword(businessId, id, { id: callerId, role: callerRole }, body.newPassword);
  }

  @Delete(':id')
  @RequirePermissions(Permission.USER_MANAGE)
  remove(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') callerId: string,
    @Param('id') id: string,
  ) {
    return this.users.remove(businessId, id, callerId);
  }
}
