import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CreateTxnInput } from '../txns/txn-core.service';
import { PurchaseService } from './purchase.service';

type PurchaseBody = Omit<CreateTxnInput, 'txnType'>;

@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
@UseGuards(PermissionsGuard)
export class PurchaseController {
  constructor(private purchase: PurchaseService) {}

  @Get('bills')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listBills(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.purchase.listBills(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('bills')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  createBill(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: PurchaseBody,
  ) {
    return this.purchase.createBill(businessId, userId, body);
  }

  @Get('debit-notes')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listDebitNotes(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.purchase.listDebitNotes(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('debit-notes')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  createDebitNote(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: PurchaseBody,
  ) {
    return this.purchase.createDebitNote(businessId, userId, body);
  }

  @Get('orders')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listOrders(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.purchase.listOrders(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('orders')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  createOrder(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: PurchaseBody,
  ) {
    return this.purchase.createOrder(businessId, userId, body);
  }

  @Post('orders/:id/receive')
  @RequirePermissions(Permission.INVENTORY_MANAGE)
  receiveOrder(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body?: Partial<CreateTxnInput>,
  ) {
    return this.purchase.receiveOrder(businessId, userId, id, body);
  }

  @Get('payments-out')
  @RequirePermissions(Permission.EXPENSE_VIEW)
  listPaymentsOut(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.purchase.listPaymentsOut(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post('payments-out')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  createPaymentOut(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: PurchaseBody & { amount?: number; autoAllocate?: boolean },
  ) {
    return this.purchase.createPaymentOut(businessId, userId, body);
  }
}
