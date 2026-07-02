import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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

  @Get()
  @RequirePermissions(Permission.INVENTORY_VIEW, Permission.POS_SELL)
  findAll(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.categories.findAll(businessId, branchId);
  }

  @Post()
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  create(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: { name: string; slug: string; parentId?: string },
  ) {
    return this.categories.create(businessId, branchId, body);
  }
}
