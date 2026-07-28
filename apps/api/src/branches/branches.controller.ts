import { Body, Controller, Delete, Get, Post, UseGuards, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { BranchesService } from './branches.service';

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
@UseGuards(PermissionsGuard)
export class BranchesController {
  constructor(private branches: BranchesService) {}

  @Get()
  findAll(
    @CurrentUser('businessId') businessId: string,
    @Query('type') type?: string,
  ) {
    return this.branches.findAll(businessId, type);
  }

  @Post()
  @RequirePermissions(Permission.BRANCH_MANAGE)
  create(
    @CurrentUser('businessId') businessId: string,
    @Body() body: { name: string; code: string; address?: string; type?: string },
  ) {
    return this.branches.create(businessId, body);
  }

  @Get(':id/metrics')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  getMetrics(
    @CurrentUser('businessId') businessId: string,
    @Param('id') branchId: string,
  ) {
    return this.branches.getBranchMetrics(businessId, branchId);
  }

  @Delete(':id')
  @RequirePermissions(Permission.BRANCH_MANAGE)
  remove(
    @CurrentUser('businessId') businessId: string,
    @Param('id') branchId: string,
  ) {
    return this.branches.remove(businessId, branchId);
  }
}
