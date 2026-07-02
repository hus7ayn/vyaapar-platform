import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ExportsService } from './exports.service';

@ApiTags('exports')
@ApiBearerAuth()
@Controller('exports')
@UseGuards(PermissionsGuard)
export class ExportsController {
  constructor(private exports: ExportsService) {}

  @Get('txns')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  async txns(
    @CurrentUser('businessId') businessId: string,
    @Query('type') type = 'ALL',
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const result = await this.exports.exportTxns(businessId, type, from, to, format);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename=transactions.${result.ext}`);
    res.send(result.content);
  }

  @Get('parties')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  async parties(
    @CurrentUser('businessId') businessId: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const result = await this.exports.exportParties(businessId, format);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename=parties.${result.ext}`);
    res.send(result.content);
  }

  @Get('items')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  async items(
    @CurrentUser('businessId') businessId: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const result = await this.exports.exportItems(businessId, format);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename=items.${result.ext}`);
    res.send(result.content);
  }

  @Get('gstr1-json')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  gstr1Json(
    @CurrentUser('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.exports.exportGstr1Json(businessId, from, to);
  }

  @Get('sales')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  async sales(
    @CurrentUser('businessId') businessId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const result = await this.exports.exportSales(businessId, from, to, format);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename=sales.${result.ext}`);
    res.send(result.content);
  }

  @Get('inventory')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  async inventory(
    @CurrentUser('businessId') businessId: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const result = await this.exports.exportInventory(businessId, format);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename=inventory.${result.ext}`);
    res.send(result.content);
  }

  @Get('payroll')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  async payroll(
    @CurrentUser('businessId') businessId: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const result = await this.exports.exportPayroll(businessId, format);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename=payroll.${result.ext}`);
    res.send(result.content);
  }

  @Get('expenses')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  async expenses(
    @CurrentUser('businessId') businessId: string,
    @Query('format') format: 'xlsx' | 'csv' = 'xlsx',
    @Res() res: Response,
  ) {
    const result = await this.exports.exportExpenses(businessId, format);
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename=expenses.${result.ext}`);
    res.send(result.content);
  }
}
