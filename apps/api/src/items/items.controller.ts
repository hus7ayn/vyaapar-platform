import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ItemInput, ItemsService } from './items.service';

@ApiTags('items')
@ApiBearerAuth()
@Controller('items')
@UseGuards(PermissionsGuard)
export class ItemsController {
  constructor(private items: ItemsService) {}

  @Get()
  @RequirePermissions(Permission.INVENTORY_VIEW)
  list(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.items.list(businessId, { ...q, branchId });
  }

  @Get('summary')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  summary(@CurrentUser('businessId') businessId: string, @CurrentUser('branchId') branchId?: string) {
    return this.items.summary(businessId, branchId);
  }

  @Get('pos-catalog')
  @RequirePermissions(Permission.POS_SELL)
  posCatalog(@CurrentUser('businessId') businessId: string, @CurrentUser('branchId') branchId?: string) {
    return this.items.posCatalog(businessId, branchId);
  }

  @Get('units')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listUnits(@CurrentUser('businessId') businessId: string) {
    return this.items.listUnits(businessId);
  }

  @Post('units')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  createUnit(@CurrentUser('businessId') businessId: string, @Body() body: { name: string; shortName: string }) {
    return this.items.createUnit(businessId, body);
  }

  @Get('barcode-image')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  async barcodeImage(@Query('text') text: string, @Query('format') format?: string) {
    const dataUrl = format === 'qr'
      ? await this.items.generateQrPng(text)
      : await this.items.generateBarcodePng(text);
    return { dataUrl };
  }

  @Get('barcode/:barcode')
  @RequirePermissions(Permission.POS_SELL)
  byBarcode(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Param('barcode') barcode: string,
  ) {
    return this.items.findByBarcode(businessId, barcode, branchId);
  }

  @Post('bulk-barcodes')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  bulkBarcodes(@CurrentUser('businessId') businessId: string, @CurrentUser('branchId') branchId?: string) {
    return this.items.bulkGenerateBarcodes(businessId, branchId);
  }

  @Post('import')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  import(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body('rows') rows: ItemInput[],
  ) {
    return this.items.import(businessId, rows ?? [], branchId);
  }

  @Get(':id')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  get(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.items.get(businessId, id, branchId);
  }

  @Get(':id/transactions')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  transactions(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.items.transactions(businessId, id);
  }

  @Post()
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  create(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: ItemInput,
  ) {
    return this.items.create(businessId, body, branchId, { requireComplete: true });
  }

  @Post(':id/adjust')
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  adjust(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Param('id') id: string,
    @Body() body: { adjType: string; quantity: number; atPrice?: number; details?: string; date?: string },
  ) {
    return this.items.adjustStock(businessId, id, body, branchId);
  }

  @Post(':id/assign-barcode')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  assignBarcode(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.items.assignBarcode(businessId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  update(@CurrentUser('businessId') businessId: string, @Param('id') id: string, @Body() body: Partial<ItemInput>) {
    return this.items.update(businessId, id, body);
  }

  @Delete(':id')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  remove(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.items.remove(businessId, id);
  }
}
