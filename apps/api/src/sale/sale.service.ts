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

  /**
   * Return an invoice as a credit note. Full return (no lineIds) reproduces the
   * whole invoice incl. bill discount/charges and refunds its exact total.
   * Partial return (lineIds) returns those whole lines only, refunding the sum
   * of their stored line totals (roundOff disabled so payment == total exactly).
   * mode EXCHANGE / cashRefund:false records the return as store credit (no cash
   * out) so a replacement sale can be rung up; REFUND (default) pays cash back.
   */
  async refundInvoice(
    businessId: string,
    userId: string,
    id: string,
    body?: { payments?: TxnPaymentInput[]; lineIds?: string[]; cashRefund?: boolean; mode?: 'REFUND' | 'EXCHANGE' },
  ) {
    const txn = await this.core.getTxn(businessId, id);
    if (txn.txnType !== 'SALE_INVOICE') throw new BadRequestException('Not a sale invoice');

    // How much of each original line was already returned by prior credit notes, so a
    // line can be returned across multiple sessions and is never over-returned.
    const priorReturns = await this.core.prisma.txn.findMany({
      where: { businessId, txnType: 'CREDIT_NOTE', returnAgainstTxnId: txn.id, deletedAt: null },
      include: { lines: true },
    });
    const sig = (l: { itemId: string | null; name: string; unitPrice: Prisma.Decimal | number }) =>
      `${l.itemId ?? l.name}|${Number(l.unitPrice)}`;
    const returnedBySig: Record<string, number> = {};
    for (const cn of priorReturns)
      for (const l of cn.lines) returnedBySig[sig(l)] = (returnedBySig[sig(l)] ?? 0) + Number(l.quantity);
    const returnedQtyByLine: Record<string, number> = {};
    for (const l of txn.lines) {
      const avail = returnedBySig[sig(l)] ?? 0;
      const take = Math.min(avail, Number(l.quantity));
      returnedQtyByLine[l.id] = take;
      returnedBySig[sig(l)] = avail - take;
    }
    const fullyReturned = (l: { id: string; quantity: Prisma.Decimal | number }) =>
      (returnedQtyByLine[l.id] ?? 0) >= Number(l.quantity) - 1e-6;

    const partial = !!body?.lineIds?.length;
    const requested = partial ? txn.lines.filter((l) => body!.lineIds!.includes(l.id)) : txn.lines;
    const selected = requested.filter((l) => !fullyReturned(l));
    if (!selected.length) throw new BadRequestException('The selected item(s) have already been returned');

    const cashRefund = body?.cashRefund !== false && body?.mode !== 'EXCHANGE';
    const label = body?.mode === 'EXCHANGE' ? 'Exchange' : 'Return';
    // Reproduce bill-level discount/charges only for a pristine full return; otherwise refund
    // the exact sum of the selected line totals (roundOff off so payment == total exactly).
    const pristineFull = !partial && priorReturns.length === 0 && selected.length === txn.lines.length;

    const lines = selected.map((l) => ({
      itemId: l.itemId ?? undefined,
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit,
      unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount),
      taxRate: Number(l.taxRate),
    }));

    let creditNote;
    if (!pristineFull) {
      // Sum of stored (2dp) line totals; roundOff off so createTxn's total matches exactly.
      const refundTotal = selected.reduce((s, l) => s + Number(l.total), 0);
      creditNote = await this.core.createTxn(businessId, userId, {
        txnType: 'CREDIT_NOTE',
        branchId: txn.branchId ?? undefined,
        partyId: txn.partyId ?? undefined,
        partyName: txn.partyName ?? undefined,
        returnAgainstTxnId: txn.id,
        lines,
        roundOffEnabled: false,
        payments: cashRefund ? [{ paymentType: 'CASH', amount: refundTotal }] : [],
        description: `${label} against ${txn.txnNumber}`,
      });
    } else {
      creditNote = await this.core.createTxn(businessId, userId, {
        txnType: 'CREDIT_NOTE',
        branchId: txn.branchId ?? undefined,
        partyId: txn.partyId ?? undefined,
        partyName: txn.partyName ?? undefined,
        returnAgainstTxnId: txn.id,
        lines,
        discountPercent: txn.discountPercent != null ? Number(txn.discountPercent) : undefined,
        discountAmount: txn.discountPercent == null ? Number(txn.discountAmount) : undefined,
        additionalCharges: (txn.additionalCharges as { name: string; amount: number }[] | null) ?? undefined,
        payments: body?.payments ?? (cashRefund ? [{ paymentType: 'CASH', amount: Number(txn.total) }] : []),
        description: `${label} against ${txn.txnNumber}`,
      });
    }

    // Mark REFUNDED once every line has been fully returned (this credit note included).
    const remaining = txn.lines.filter((l) => !fullyReturned(l) && !selected.some((s) => s.id === l.id));
    if (remaining.length === 0) {
      await this.core.prisma.txn.update({ where: { id }, data: { status: 'REFUNDED' } });
    }
    return creditNote;
  }

  /**
   * Exchange: cash-refund the selected returned items, then ring up chosen
   * replacement items as a new fully-paid sale. Net cash = new sale total minus
   * refund. Totals are computed on the backend so the sale is deterministically paid.
   */
  async exchangeInvoice(
    businessId: string,
    userId: string,
    id: string,
    body: { lineIds?: string[]; replacements: { itemId: string; quantity: number }[] },
  ) {
    if (!body.replacements?.length) throw new BadRequestException('Select at least one replacement item');
    const txn = await this.core.getTxn(businessId, id);
    if (txn.txnType !== 'SALE_INVOICE') throw new BadRequestException('Not a sale invoice');

    // 1. Return the selected items for cash.
    const creditNote = await this.refundInvoice(businessId, userId, id, { lineIds: body.lineIds, mode: 'REFUND' });

    // 2. Ring up the replacement items as a new fully-paid sale.
    const items = await this.core.prisma.item.findMany({
      where: { id: { in: body.replacements.map((r) => r.itemId) }, businessId },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    let total = 0;
    const lines = body.replacements.map((r) => {
      const item = itemMap.get(r.itemId);
      if (!item) throw new BadRequestException('Replacement item not found');
      const unitPrice = Number(item.salePrice);
      const taxRate = Number(item.taxRate);
      const qty = Number(r.quantity) || 1;
      total += unitPrice * qty * (1 + taxRate / 100);
      return { itemId: item.id, name: item.name, quantity: qty, unit: item.baseUnit, unitPrice, taxRate };
    });
    // Floor so the CASH payment never exceeds createTxn's computed total (no paidAmount>total error).
    const paid = Math.floor(total * 100) / 100;
    const sale = await this.core.createTxn(businessId, userId, {
      txnType: 'SALE_INVOICE',
      branchId: txn.branchId ?? undefined,
      partyId: txn.partyId ?? undefined,
      partyName: txn.partyName ?? undefined,
      lines,
      roundOffEnabled: false,
      payments: [{ paymentType: 'CASH', amount: paid }],
      description: `Exchange for ${txn.txnNumber}`,
    });
    return { creditNote, sale };
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
