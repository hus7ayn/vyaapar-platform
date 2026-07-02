import { Body, Controller, Get, Patch, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ServicesService } from './services.service';

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
@UseGuards(PermissionsGuard)
export class ServicesController {
  constructor(private services: ServicesService) {}

  @Get()
  @RequirePermissions(Permission.SERVICE_VIEW)
  findAll(
    @CurrentUser('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.services.findAll(businessId, status, branchId);
  }

  @Post()
  @RequirePermissions(Permission.SERVICE_MANAGE)
  create(@CurrentUser('businessId') businessId: string, @Body() body: never) {
    return this.services.create(businessId, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SERVICE_MANAGE)
  update(@Param('id') id: string, @Body() body: { status: string; assignedTo?: string }) {
    return this.services.updateStatus(id, body.status, body.assignedTo);
  }
}
