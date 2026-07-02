import { Body, Controller, Get, Post, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { HousekeepingService } from './housekeeping.service';

@ApiTags('housekeeping')
@ApiBearerAuth()
@Controller('housekeeping')
@UseGuards(PermissionsGuard)
export class HousekeepingController {
  constructor(private hk: HousekeepingService) {}

  @Get()
  @RequirePermissions(Permission.HK_VIEW)
  findAll(
    @CurrentUser('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.hk.findAll(businessId, status, branchId);
  }

  @Post()
  @RequirePermissions(Permission.HK_MANAGE)
  create(
    @CurrentUser('businessId') businessId: string,
    @Body() body: { roomId: string; priority?: string; notes?: string },
  ) {
    return this.hk.create(businessId, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.HK_MANAGE)
  update(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { status: string; assignedTo?: string },
  ) {
    return this.hk.updateStatus(id, businessId, body.status, body.assignedTo);
  }
}
