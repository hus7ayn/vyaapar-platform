import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
@UseGuards(PermissionsGuard)
export class CategoriesController {
  constructor(private categories: CategoriesService) {}

  // An explicit branchId (query) overrides the caller's active branch so a
  // caller can manage another branch's categories.
  @Get()
  @RequirePermissions(Permission.INVENTORY_VIEW, Permission.POS_SELL)
  findAll(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query('branchId') branchIdQuery?: string,
  ) {
    return this.categories.findAll(businessId, branchIdQuery ?? branchId);
  }

  @Post()
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  create(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: { name: string; slug?: string; parentId?: string; branchId?: string },
  ) {
    return this.categories.create(businessId, body.branchId ?? branchId, body);
  }

  @Delete(':id')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  remove(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.categories.remove(businessId, id);
  }
}
