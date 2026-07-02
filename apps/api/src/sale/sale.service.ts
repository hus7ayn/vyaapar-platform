import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateTxnInput, TxnCoreService, TxnPaymentInput } from '../txns/txn-core.service';
import { EventsGateway } from '../events/events.gateway';

type SaleBody = Omit<CreateTxnInput, 'txnType'>;

@Injectable()
export class SaleService {
  constructor(private core: TxnCoreService, private events: EventsGateway) {}

  // ─── Sale Invoices (also powers POS) ───────────────────────────────────────

  async createInvoice(businessId: string, userId: string, body: SaleBody) {
    // Credit-limit check
    if (body.partyId && body.payments?.some((p) => p.paymentType === 'DEBT')) {
      const party = await this.core.prisma.party.findFirst({ where: { id: body.partyId, businessId } });
      if (party?.creditLimit != null) {
        const debtAmount = body.payments.filter((p) => p.paymentType === 'DEBT').reduce((s, p) => s + p.amount, 0);
        if (Number(party.currentBalance) + debtAmount > Number(party.creditLimit)) {
          throw new BadRequestException(`Credit limit exceeded for ${party.name}`);
        }
      }
    }
    const txn = await this.core.createTxn(businessId, userId, { ...body, txnType: 'SALE_INVOICE' });
    this.events.emitOrderUpdate(businessId, txn.branchId ?? '', txn);
    return txn;
  }

  listInvoices(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'SALE_INVOICE' });
  }

  listHeld(businessId: string, branchId?: string) {
    return this.core.listTxns(businessId, { txnType: 'SALE_INVOICE', status: 'HELD', branchId, limit: 100 });
  }

  /** Resume a held POS invoice: post effects with given payments. */
  async resumeHeld(businessId: string, id: string, payments: TxnPaymentInput[]) {
    const txn = await this.core.getTxn(businessId, id);
    if (txn.status !== 'HELD') throw new BadRequestException('Transaction is not held');

    const paid = (payments ?? []).filter((p) => p.paymentType !== 'DEBT').reduce((s, p) => s.add(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
    if (paid.gt(txn.total)) throw new BadRequestException('Paid amount exceeds total');
    const balance = txn.total.sub(paid);

    return this.core.prisma.$transaction(async (tx) => {
      const updated = await tx.txn.update({
        where: { id },
        data: {
          status: balance.lte(0) ? 'PAID' : paid.gt(0) ? 'PARTIAL' : 'OPEN',
          paidAmount: paid,
          balance,
          heldAt: null,
          date: new Date(),
        },
        include: { lines: true },
      });
      await this.core.postEffects(tx, businessId, updated, {}, payments ?? []);
      return updated;
    });
  }

  /** Full refund of an invoice → creates a credit note against it. */
  async refundInvoice(businessId: string, userId: string, id: string, body?: { payments?: TxnPaymentInput[] }) {
    const txn = await this.core.getTxn(businessId, id);
    if (txn.txnType !== 'SALE_INVOICE') throw new BadRequestException('Not a sale invoice');
    if (txn.returns.length) throw new BadRequestException('Invoice already refunded');

    const creditNote = await this.core.createTxn(businessId, userId, {
      txnType: 'CREDIT_NOTE',
      branchId: txn.branchId ?? undefined,
      partyId: txn.partyId ?? undefined,
      partyName: txn.partyName ?? undefined,
      returnAgainstTxnId: txn.id,
      lines: txn.lines.map((l) => ({
        itemId: l.itemId ?? undefined,
        name: l.name,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: Number(l.unitPrice),
        discountAmount: Number(l.discountAmount),
        taxRate: Number(l.taxRate),
      })),
      payments: body?.payments ?? [{ paymentType: 'CASH', amount: Number(txn.total) }],
      description: `Refund against ${txn.txnNumber}`,
    });
    await this.core.prisma.txn.update({ where: { id }, data: { status: 'REFUNDED' } });
    return creditNote;
  }

  // ─── Credit Notes (Sale Return) ────────────────────────────────────────────

  createCreditNote(businessId: string, userId: string, body: SaleBody) {
    return this.core.createTxn(businessId, userId, { ...body, txnType: 'CREDIT_NOTE' });
  }

  listCreditNotes(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'CREDIT_NOTE' });
  }

  // ─── Estimates / Quotations ────────────────────────────────────────────────

  createEstimate(businessId: string, userId: string, body: SaleBody) {
    return this.core.createTxn(businessId, userId, { ...body, txnType: 'ESTIMATE' });
  }

  listEstimates(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'ESTIMATE' });
  }

  convertEstimate(businessId: string, userId: string, id: string, overrides?: Partial<CreateTxnInput>) {
    return this.core.convertTxn(businessId, userId, id, 'SALE_INVOICE', overrides);
  }

  // ─── Sale Orders ───────────────────────────────────────────────────────────

  createSaleOrder(businessId: string, userId: string, body: SaleBody) {
    return this.core.createTxn(businessId, userId, { ...body, txnType: 'SALE_ORDER' });
  }

  listSaleOrders(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'SALE_ORDER' });
  }

  convertSaleOrder(businessId: string, userId: string, id: string, overrides?: Partial<CreateTxnInput>) {
    return this.core.convertTxn(businessId, userId, id, 'SALE_INVOICE', overrides);
  }

  // ─── Delivery Challans ─────────────────────────────────────────────────────

  createChallan(businessId: string, userId: string, body: SaleBody) {
    return this.core.createTxn(businessId, userId, { ...body, txnType: 'DELIVERY_CHALLAN' });
  }

  listChallans(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'DELIVERY_CHALLAN' });
  }

  convertChallan(businessId: string, userId: string, id: string, overrides?: Partial<CreateTxnInput>) {
    return this.core.convertTxn(businessId, userId, id, 'SALE_INVOICE', overrides);
  }

  // ─── Payment In ────────────────────────────────────────────────────────────

  async createPaymentIn(businessId: string, userId: string, body: SaleBody & { amount?: number; autoAllocate?: boolean }) {
    if (!body.partyId) throw new BadRequestException('Party is required for payment-in');
    const amount = body.amount ?? body.total ?? 0;
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    let allocations = body.allocations;
    if (!allocations?.length && body.autoAllocate !== false) {
      allocations = await this.autoAllocate(businessId, body.partyId, amount, 'SALE_INVOICE');
    }

    return this.core.createTxn(businessId, userId, {
      ...body,
      txnType: 'PAYMENT_IN',
      total: amount,
      allocations,
      payments: body.payments?.length ? body.payments : [{ paymentType: 'CASH', amount }],
    });
  }

  listPaymentsIn(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'PAYMENT_IN' });
  }

  /** FIFO allocation against oldest open invoices/bills. */
  async autoAllocate(businessId: string, partyId: string, amount: number, againstType: 'SALE_INVOICE' | 'PURCHASE_BILL') {
    const open = await this.core.prisma.txn.findMany({
      where: { businessId, partyId, txnType: againstType, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, balance: { gt: 0 } },
      orderBy: { date: 'asc' },
    });
    const allocations: { againstTxnId: string; amount: number }[] = [];
    let remaining = amount;
    for (const txn of open) {
      if (remaining <= 0) break;
      const alloc = Math.min(remaining, Number(txn.balance));
      allocations.push({ againstTxnId: txn.id, amount: alloc });
      remaining -= alloc;
    }
    return allocations;
  }
}
