import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateTxnInput, TxnCoreService } from '../txns/txn-core.service';
import { SaleService } from '../sale/sale.service';

type PurchaseBody = Omit<CreateTxnInput, 'txnType'>;

@Injectable()
export class PurchaseService {
  constructor(private core: TxnCoreService, private sale: SaleService) {}

  // ─── Purchase Bills ────────────────────────────────────────────────────────

  async createBill(businessId: string, userId: string, body: PurchaseBody) {
    if (!body.partyId) throw new BadRequestException('Supplier party is required');
    const bill = await this.core.createTxn(businessId, userId, { ...body, txnType: 'PURCHASE_BILL' });

    // Vyapar updates item purchase price from the latest bill
    for (const line of bill.lines) {
      if (line.itemId) {
        await this.core.prisma.item.update({
          where: { id: line.itemId },
          data: { purchasePrice: line.unitPrice },
        }).catch(() => {});
      }
    }
    return bill;
  }

  listBills(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'PURCHASE_BILL' });
  }

  // ─── Debit Notes (Purchase Return) ─────────────────────────────────────────

  createDebitNote(businessId: string, userId: string, body: PurchaseBody) {
    return this.core.createTxn(businessId, userId, { ...body, txnType: 'DEBIT_NOTE' });
  }

  listDebitNotes(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'DEBIT_NOTE' });
  }

  // ─── Purchase Orders ───────────────────────────────────────────────────────

  createOrder(businessId: string, userId: string, body: PurchaseBody) {
    return this.core.createTxn(businessId, userId, { ...body, txnType: 'PURCHASE_ORDER' });
  }

  listOrders(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'PURCHASE_ORDER' });
  }

  /** Receive a PO → converts it into a purchase bill (stock IN + payable). */
  receiveOrder(businessId: string, userId: string, id: string, overrides?: Partial<CreateTxnInput>) {
    return this.core.convertTxn(businessId, userId, id, 'PURCHASE_BILL', overrides);
  }

  // ─── Payment Out ───────────────────────────────────────────────────────────

  async createPaymentOut(businessId: string, userId: string, body: PurchaseBody & { amount?: number; autoAllocate?: boolean }) {
    const amount = body.amount ?? body.total ?? 0;
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    let allocations = body.allocations;
    if (body.partyId && !allocations?.length && body.autoAllocate !== false) {
      allocations = await this.sale.autoAllocate(businessId, body.partyId, amount, 'PURCHASE_BILL');
    }

    return this.core.createTxn(businessId, userId, {
      ...body,
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
