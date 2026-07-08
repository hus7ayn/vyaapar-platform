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
    const doCreate = async () => {
      const txn = await this.core.createTxn(businessId, userId, { ...body, txnType: 'SALE_INVOICE' });
      this.events.emitOrderUpdate(businessId, txn.branchId ?? '', txn);
      return txn;
    };
    if (!body.partyId) return doCreate();
    // Credit-limit check. Serialize per-party via a Postgres advisory lock so two concurrent
    // sales for the same party can't both read a stale currentBalance and jointly exceed creditLimit.
    return this.core.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${body.partyId}))`;
      const party = await tx.party.findFirst({ where: { id: body.partyId, businessId } });
      if (party?.creditLimit != null) {
        const paidAmount = (body.payments ?? []).filter((p) => p.paymentType !== 'DEBT').reduce((s, p) => s + p.amount, 0);
        const balance = Number(body.total) - paidAmount;
        if (Number(party.currentBalance) + balance > Number(party.creditLimit)) {
          throw new BadRequestException(`Credit limit exceeded for ${party.name}`);
        }
      }
      return doCreate();
    });
  }

  listInvoices(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'SALE_INVOICE' });
  }

  listHeld(businessId: string, branchId?: string) {
    return this.core.listTxns(businessId, { txnType: 'SALE_INVOICE', status: 'HELD', branchId, limit: 100 });
  }

  /** Resume a held POS invoice: apply any edits to lines/discounts made after holding, then post effects with given payments. */
  async resumeHeld(businessId: string, id: string, body: SaleBody) {
    const txn = await this.core.getTxn(businessId, id);
    if (txn.status !== 'HELD') throw new BadRequestException('Transaction is not held');

    const payments = body.payments ?? [];
    const hasLines = !!body.lines?.length;

    const { built, subtotal, taxTotal } = hasLines
      ? await this.core.buildLines(businessId, body.lines!, 'sale', txn.branchId)
      : { built: null, subtotal: txn.subtotal, taxTotal: txn.taxAmount };

    const { billDiscount, roundOff, total } = hasLines
      ? this.core.computeTotals({
          subtotal,
          taxTotal,
          discountPercent: body.discountPercent,
          discountAmount: body.discountAmount,
          additionalCharges: body.additionalCharges,
          roundOffEnabled: body.roundOffEnabled,
        })
      : { billDiscount: txn.discountAmount, roundOff: txn.roundOff, total: txn.total };

    const paid = payments.filter((p) => p.paymentType !== 'DEBT').reduce((s, p) => s.add(new Prisma.Decimal(p.amount)), new Prisma.Decimal(0));
    if (paid.gt(total)) throw new BadRequestException('Paid amount exceeds total');
    const balance = total.sub(paid);

    // Credit-limit check
    if (txn.partyId) {
      const party = await this.core.prisma.party.findFirst({ where: { id: txn.partyId, businessId } });
      if (party?.creditLimit != null) {
        if (Number(party.currentBalance) + Number(balance) > Number(party.creditLimit)) {
          throw new BadRequestException(`Credit limit exceeded for ${party.name}`);
        }
      }
    }

    return this.core.prisma.$transaction(async (tx) => {
      if (hasLines) await tx.txnLine.deleteMany({ where: { txnId: id } });
      const updated = await tx.txn.update({
        where: { id },
        data: {
          status: balance.lte(0) ? 'PAID' : paid.gt(0) ? 'PARTIAL' : 'OPEN',
          paidAmount: paid,
          balance,
          heldAt: null,
          date: new Date(),
          ...(hasLines
            ? {
                subtotal,
                discountPercent: body.discountPercent != null ? new Prisma.Decimal(body.discountPercent) : null,
                discountAmount: billDiscount,
                taxAmount: taxTotal,
                additionalCharges: body.additionalCharges?.length ? body.additionalCharges : undefined,
                roundOff,
                total,
                lines: { create: built!.map(({ itemId, ...rest }) => ({ ...rest, item: itemId ? { connect: { id: itemId } } : undefined } as Prisma.TxnLineCreateWithoutTxnInput)) },
              }
            : {}),
        },
        include: { lines: true },
      });
      await this.core.postEffects(tx, businessId, updated, {}, payments);
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
      discountPercent: txn.discountPercent != null ? Number(txn.discountPercent) : undefined,
      discountAmount: txn.discountPercent == null ? Number(txn.discountAmount) : undefined,
      additionalCharges: (txn.additionalCharges as { name: string; amount: number }[] | null) ?? undefined,
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
    } else if (allocations?.length) {
      const allocatedTotal = allocations.reduce((sum, a) => sum + a.amount, 0);
      if (allocatedTotal !== amount) {
        throw new BadRequestException('Sum of allocation amounts must equal the payment amount');
      }
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
