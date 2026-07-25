import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CreateTxnInput, TxnPaymentInput } from '../txns/txn-core.service';
import { SaleService } from './sale.service';

type SaleBody = Omit<CreateTxnInput, 'txnType'>;

@ApiTags('sale')
@ApiBearerAuth()
@Controller('sale')
@UseGuards(PermissionsGuard)
export class SaleController {
  constructor(private sale: SaleService) {}

  // Invoices
  @Get('invoices')
  @RequirePermissions(Permission.POS_SELL)
  listInvoices(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.sale.listInvoices(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('invoices')
  @RequirePermissions(Permission.POS_SELL)
  createInvoice(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: SaleBody,
  ) {
    return this.sale.createInvoice(businessId, userId, body);
  }

  @Get('invoices/held')
  @RequirePermissions(Permission.POS_HOLD_ORDER)
  listHeld(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.sale.listHeld(businessId, branchId);
  }

  @Post('invoices/:id/resume')
  @RequirePermissions(Permission.POS_HOLD_ORDER)
  resumeHeld(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: SaleBody,
  ) {
    return this.sale.resumeHeld(businessId, id, body);
  }

  @Post('invoices/:id/refund')
  @RequirePermissions(Permission.POS_REFUND)
  refund(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body?: {
      payments?: TxnPaymentInput[];
      lineIds?: string[];
      returns?: { lineId: string; quantity: number }[];
      cashRefund?: boolean;
      mode?: 'REFUND' | 'EXCHANGE';
    },
  ) {
    return this.sale.refundInvoice(businessId, userId, id, body);
  }

  @Post('invoices/:id/exchange')
  @RequirePermissions(Permission.POS_REFUND)
  exchange(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body: {
      lineIds?: string[];
      returns?: { lineId: string; quantity: number }[];
      replacements: { itemId: string; quantity: number }[];
    },
  ) {
    return this.sale.exchangeInvoice(businessId, userId, id, body);
  }

  // Credit notes (sale returns)
  @Get('credit-notes')
  @RequirePermissions(Permission.POS_SELL)
  listCreditNotes(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.sale.listCreditNotes(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('credit-notes')
  @RequirePermissions(Permission.POS_REFUND)
  createCreditNote(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: SaleBody,
  ) {
    return this.sale.createCreditNote(businessId, userId, body);
  }

  // Estimates
  @Get('estimates')
  @RequirePermissions(Permission.POS_SELL)
  listEstimates(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.sale.listEstimates(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('estimates')
  @RequirePermissions(Permission.POS_SELL)
  createEstimate(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: SaleBody,
  ) {
    return this.sale.createEstimate(businessId, userId, body);
  }

  @Post('estimates/:id/convert')
  @RequirePermissions(Permission.POS_SELL)
  convertEstimate(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body?: Partial<CreateTxnInput>,
  ) {
    return this.sale.convertEstimate(businessId, userId, id, body);
  }

  // Sale orders
  @Get('orders')
  @RequirePermissions(Permission.POS_SELL)
  listSaleOrders(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.sale.listSaleOrders(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('orders')
  @RequirePermissions(Permission.POS_SELL)
  createSaleOrder(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: SaleBody,
  ) {
    return this.sale.createSaleOrder(businessId, userId, body);
  }

  @Post('orders/:id/convert')
  @RequirePermissions(Permission.POS_SELL)
  convertSaleOrder(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body?: Partial<CreateTxnInput>,
  ) {
    return this.sale.convertSaleOrder(businessId, userId, id, body);
  }

  // Delivery challans
  @Get('challans')
  @RequirePermissions(Permission.POS_SELL)
  listChallans(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.sale.listChallans(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('challans')
  @RequirePermissions(Permission.POS_SELL)
  createChallan(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: SaleBody,
  ) {
    return this.sale.createChallan(businessId, userId, body);
  }

  @Post('challans/:id/convert')
  @RequirePermissions(Permission.POS_SELL)
  convertChallan(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body?: Partial<CreateTxnInput>,
  ) {
    return this.sale.convertChallan(businessId, userId, id, body);
  }

  // Payment in
  @Get('payments-in')
  @RequirePermissions(Permission.POS_SELL)
  listPaymentsIn(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.sale.listPaymentsIn(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('payments-in')
  @RequirePermissions(Permission.POS_SELL)
  createPaymentIn(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: SaleBody & { amount?: number; autoAllocate?: boolean },
  ) {
    return this.sale.createPaymentIn(businessId, userId, body);
  }
}
