import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(PermissionsGuard)
@RequirePermissions(Permission.REPORTS_VIEW)
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId?: string) {
    return this.reports.dashboard(b, branchId);
  }

  // Transaction reports
  @Get('sale')
  sale(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.saleReport(b, from, to, branchId);
  }

  @Get('purchase')
  purchase(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.purchaseReport(b, from, to, branchId);
  }

  @Get('day-book')
  dayBook(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('date') date: string) {
    return this.reports.dayBook(b, date ?? new Date().toISOString().slice(0, 10), branchId);
  }

  @Get('all-transactions')
  allTxns(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.allTransactions(b, from, to, branchId);
  }

  @Get('cash-flow')
  cashFlow(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.cashFlow(b, from, to, branchId);
  }

  @Get('bill-wise-profit')
  billWiseProfit(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.billWiseProfit(b, from, to, branchId);
  }

  // Party reports
  @Get('all-parties')
  allParties(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId?: string) {
    return this.reports.allParties(b, branchId);
  }

  @Get('party-wise-profit')
  partyWiseProfit(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.partyWiseProfit(b, from, to, branchId);
  }

  @Get('sale-purchase-by-party')
  salePurchaseByParty(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.salePurchaseByParty(b, from, to, branchId);
  }

  // Item / stock reports
  @Get('stock-summary')
  stockSummary(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId?: string) {
    return this.reports.stockSummary(b, branchId);
  }

  @Get('item-wise-profit')
  itemWiseProfit(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.itemWiseProfit(b, from, to, branchId);
  }

  @Get('low-stock')
  lowStock(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId?: string) {
    return this.reports.lowStock(b, branchId);
  }

  @Get('stock-detail')
  stockDetail(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('itemId') itemId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.stockDetail(b, itemId, from, to, branchId);
  }

  @Get('by-item-category/:side')
  byItemCategory(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Param('side') side: 'sale' | 'purchase', @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.byItemCategory(b, side, from, to, branchId);
  }

  @Get('discount')
  discount(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.discountReport(b, from, to, branchId);
  }

  // Financial
  @Get('pnl')
  pnl(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.profitAndLoss(b, from, to, branchId);
  }

  @Get('trial-balance')
  trialBalance(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId?: string) {
    return this.reports.trialBalance(b, branchId);
  }

  @Get('balance-sheet')
  balanceSheet(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId?: string) {
    return this.reports.balanceSheet(b, branchId);
  }

  // GST
  @Get('gstr1')
  gstr1(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.gstr1(b, from, to, branchId);
  }

  @Get('gstr2')
  gstr2(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.gstr2(b, from, to, branchId);
  }

  @Get('gstr3b')
  gstr3b(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.gstr3b(b, from, to, branchId);
  }

  @Get('hsn-summary')
  hsnSummary(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.hsnSummary(b, from, to, branchId);
  }

  @Get('tax-rate')
  taxRate(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.taxRateReport(b, from, to, branchId);
  }

  // Hotel (PMS)
  // Honor an explicit ?branchId (like every /hotel/* endpoint). The hotel dashboard passes
  // the hotel branch here; without this it fell back to the resolved global active-shop
  // branch and reported zero rooms/revenue for a shop that isn't the hotel.
  @Get('hotel')
  hotel(
    @CurrentUser('businessId') b: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.reports.hotelReport(b, queryBranchId || branchId);
  }

  // Orders
  @Get('orders/:side')
  orders(@CurrentUser('businessId') b: string, @CurrentUser('branchId') branchId: string | undefined, @Param('side') side: 'sale' | 'purchase', @Query('status') status?: string) {
    return this.reports.orderReport(b, side, status, branchId);
  }
}
