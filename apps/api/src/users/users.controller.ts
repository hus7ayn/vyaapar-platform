import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USER_MANAGE)
  findAll(@CurrentUser('businessId') businessId: string) {
    return this.users.findAll(businessId);
  }

  @Post()
  @RequirePermissions(Permission.USER_MANAGE)
  create(@CurrentUser('businessId') businessId: string, @Body() body: never) {
    return this.users.create(businessId, body);
  }
}
