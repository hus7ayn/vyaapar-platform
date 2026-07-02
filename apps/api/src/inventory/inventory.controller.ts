import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
@UseGuards(PermissionsGuard)
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @Get('warehouses')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  getWarehouses(@CurrentUser('businessId') businessId: string) {
    return this.inventory.getWarehouses(businessId);
  }

  @Get('stock')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  getStock(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId?: string,
  ) {
    return this.inventory.getStockLevels(businessId, branchId);
  }

  @Get('low-stock')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  lowStock(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId?: string,
  ) {
    return this.inventory.getLowStock(businessId, branchId);
  }

  @Post('transfer')
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  transfer(
    @CurrentUser('businessId') businessId: string,
    @Body()
    body: { itemId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number },
  ) {
    return this.inventory.transferStock(businessId, body);
  }

  @Post('adjust')
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  adjust(
    @CurrentUser('businessId') businessId: string,
    @Body() body: { itemId: string; warehouseId: string; branchId?: string; quantity: number; notes?: string },
  ) {
    return this.inventory.adjustStock(businessId, body);
  }

  @Post('threshold')
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  updateThreshold(
    @Body() body: { stockLevelId: string; minStock: number },
  ) {
    return this.inventory.updateThreshold(body.stockLevelId, body.minStock);
  }
}
