import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateTxnInput, TxnCoreService } from '../txns/txn-core.service';
import { SaleService } from '../sale/sale.service';

type PurchaseBody = Omit<CreateTxnInput, 'txnType'>;

@Injectable()
export class PurchaseService {
  constructor(private core: TxnCoreService, private sale: SaleService) {}

  /**
   * The shop a purchase document belongs to. The body wins when it names one (the back-office
   * form sends the shop the user is looking at); otherwise the caller's own resolved branch.
   *
   * Leaving this undefined is not "no opinion" — it stores branch_id NULL, and every list and
   * report filters by branch, so the document simply never appears again: 'unikid' had four
   * PAYMENT_OUT rows worth 85,000 that no screen would show. Mirrors ExpensesService.create.
   */
  private branchOf(body: PurchaseBody, branchId?: string) {
    return body.branchId ?? branchId;
  }

  // ─── Purchase Bills ────────────────────────────────────────────────────────

  async createBill(businessId: string, userId: string, body: PurchaseBody, branchId?: string) {
    if (!body.partyId) throw new BadRequestException('Supplier party is required');
    const bill = await this.core.createTxn(businessId, userId, {
      ...body,
      branchId: this.branchOf(body, branchId),
      txnType: 'PURCHASE_BILL',
    });
    await this.syncItemPurchasePrices(bill);
    return bill;
  }

  // Vyapar updates item purchase price from the latest bill
  private async syncItemPurchasePrices(bill: { lines: { itemId?: string | null; unitPrice: number | Prisma.Decimal }[] }) {
    for (const line of bill.lines) {
      if (line.itemId) {
        await this.core.prisma.item.update({
          where: { id: line.itemId },
          data: { purchasePrice: line.unitPrice },
        }).catch(() => {});
      }
    }
  }

  listBills(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'PURCHASE_BILL' });
  }

  // ─── Debit Notes (Purchase Return) ─────────────────────────────────────────

  createDebitNote(businessId: string, userId: string, body: PurchaseBody, branchId?: string) {
    return this.core.createTxn(businessId, userId, {
      ...body,
      branchId: this.branchOf(body, branchId),
      txnType: 'DEBIT_NOTE',
    });
  }

  listDebitNotes(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'DEBIT_NOTE' });
  }

  // ─── Purchase Orders ───────────────────────────────────────────────────────

  createOrder(businessId: string, userId: string, body: PurchaseBody, branchId?: string) {
    return this.core.createTxn(businessId, userId, {
      ...body,
      branchId: this.branchOf(body, branchId),
      txnType: 'PURCHASE_ORDER',
    });
  }

  listOrders(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'PURCHASE_ORDER' });
  }

  /** Receive a PO → converts it into a purchase bill (stock IN + payable). */
  async receiveOrder(businessId: string, userId: string, id: string, overrides?: Partial<CreateTxnInput>) {
    const bill = await this.core.convertTxn(businessId, userId, id, 'PURCHASE_BILL', overrides);
    await this.syncItemPurchasePrices(bill);
    return bill;
  }

  // ─── Payment Out ───────────────────────────────────────────────────────────

  async createPaymentOut(
    businessId: string,
    userId: string,
    body: PurchaseBody & { amount?: number; autoAllocate?: boolean },
    branchId?: string,
  ) {
    if (!body.partyId) throw new BadRequestException('Party is required for payment-out');
    const amount = body.amount ?? body.total ?? 0;
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    let allocations = body.allocations;
    if (body.partyId && !allocations?.length && body.autoAllocate !== false) {
      allocations = await this.sale.autoAllocate(businessId, body.partyId, amount, 'PURCHASE_BILL');
    }

    return this.core.createTxn(businessId, userId, {
      ...body,
      branchId: this.branchOf(body, branchId),
      txnType: 'PAYMENT_OUT',
      total: amount,
      allocations,
      payments: body.payments?.length ? body.payments : [{ paymentType: 'CASH', amount }],
    });
  }

  listPaymentsOut(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'PAYMENT_OUT' });
  }
}
