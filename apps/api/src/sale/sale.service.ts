import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateTxnInput, TxnCoreService, TxnLineInput, TxnPaymentInput } from '../txns/txn-core.service';
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

    // No clientId and no party → nothing to guard, create directly.
    if (!body.clientId && !body.partyId) return doCreate();

    // Wrap the idempotency check + create in ONE advisory-locked transaction. The xact lock is
    // held until this outer transaction commits — which happens AFTER createTxn's own inner insert
    // has committed — so a second request carrying the same clientId blocks here, then sees the
    // first invoice below and returns it instead of creating a duplicate. This makes a
    // retried/double-submitted/timed-out checkout safe even under a slow server, atomically, with
    // no reliance on a unique index (which a bulk `prisma db push` could fail to add on live data).
    return this.core.prisma.$transaction(async (tx) => {
      if (body.clientId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`saleinv:${businessId}:${body.clientId}`}))`;
        // Match only FINALISED sales (never a HELD placeholder) so completing a bill after a
        // held one with the same key can't return the unpaid hold as if it were a real sale.
        const existing = await tx.txn.findFirst({
          where: { businessId, clientId: body.clientId, txnType: 'SALE_INVOICE', status: { not: 'HELD' } },
        });
        if (existing) return existing;
      }

      // Credit-limit check. Serialize per-party via a Postgres advisory lock so two concurrent
      // sales for the same party can't both read a stale currentBalance and jointly exceed creditLimit.
      if (body.partyId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${body.partyId}))`;
        const party = await tx.party.findFirst({ where: { id: body.partyId, businessId } });
        if (party?.creditLimit != null) {
          const paidAmount = (body.payments ?? []).filter((p) => p.paymentType !== 'DEBT').reduce((s, p) => s + p.amount, 0);
          const balance = Number(body.total) - paidAmount;
          if (Number(party.currentBalance) + balance > Number(party.creditLimit)) {
            throw new BadRequestException(`Credit limit exceeded for ${party.name}`);
          }
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
      // enforceMinSalePrice: resuming a held bill finalises a real sale, so the below-cost guard
      // must apply here too (this is the main POS "Charge" path for parked bills).
      ? await this.core.buildLines(businessId, body.lines!, 'sale', txn.branchId, true)
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
      // Atomic claim: flip HELD -> (transient) OPEN under the row lock. A concurrent double-tap /
      // retried resume blocks here, then finds status no longer HELD and aborts — so stock, ledger
      // and cash are never posted twice. The real final status is set by the update below.
      const claim = await tx.txn.updateMany({ where: { id, businessId, status: 'HELD' }, data: { status: 'OPEN', heldAt: null } });
      if (claim.count === 0) throw new BadRequestException('This bill has already been resumed');
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
   * Return an invoice as a credit note, at QUANTITY granularity. `returns:[{lineId,quantity}]`
   * returns exactly those units; `lineIds` returns each named line's remaining quantity; no
   * selector = full return (reproduces bill discount/charges, refunds the exact total). Each
   * credit-note line links back to its source invoice line (sourceLineId) so cumulative
   * returned quantity is exact and a line can never be over-returned. mode EXCHANGE /
   * cashRefund:false records store credit (no cash out); REFUND (default) pays cash back.
   */
  async refundInvoice(
    businessId: string,
    userId: string,
    id: string,
    body?: {
      payments?: TxnPaymentInput[];
      lineIds?: string[];
      returns?: { lineId: string; quantity: number }[];
      cashRefund?: boolean;
      mode?: 'REFUND' | 'EXCHANGE';
    },
  ) {
    const txn = await this.core.getTxn(businessId, id);
    if (txn.txnType !== 'SALE_INVOICE') throw new BadRequestException('Not a sale invoice');

    // Exact already-returned quantity per original line: prefer the sourceLineId link on
    // prior credit-note lines; fall back to signature matching for legacy rows (null link).
    const priorReturns = await this.core.prisma.txn.findMany({
      where: { businessId, txnType: 'CREDIT_NOTE', returnAgainstTxnId: txn.id, deletedAt: null },
      include: { lines: true },
    });
    const sig = (l: { itemId: string | null; name: string; unitPrice: Prisma.Decimal | number }) =>
      `${l.itemId ?? l.name}|${Number(l.unitPrice)}`;
    const alreadyReturned: Record<string, number> = {};
    const legacyBySig: Record<string, number> = {};
    for (const cn of priorReturns)
      for (const l of cn.lines) {
        if (l.sourceLineId) alreadyReturned[l.sourceLineId] = (alreadyReturned[l.sourceLineId] ?? 0) + Number(l.quantity);
        else legacyBySig[sig(l)] = (legacyBySig[sig(l)] ?? 0) + Number(l.quantity);
      }
    for (const l of txn.lines) {
      const already = alreadyReturned[l.id] ?? 0;
      const cap = Number(l.quantity) - already;
      const take = Math.min(Math.max(0, legacyBySig[sig(l)] ?? 0), Math.max(0, cap));
      alreadyReturned[l.id] = already + take;
      if (legacyBySig[sig(l)] != null) legacyBySig[sig(l)] -= take;
    }
    const remainingOf = (l: { id: string; quantity: Prisma.Decimal | number }) =>
      Number(l.quantity) - (alreadyReturned[l.id] ?? 0);

    const lineById = new Map(txn.lines.map((l) => [l.id, l]));
    const cashRefund = body?.cashRefund !== false && body?.mode !== 'EXCHANGE';
    const label = body?.mode === 'EXCHANGE' ? 'Exchange' : 'Return';

    // Resolve the requested (lineId, quantity) returns.
    const reqs: { lineId: string; quantity: number }[] = body?.returns?.length
      ? body.returns
      : (body?.lineIds?.length ? txn.lines.filter((l) => body!.lineIds!.includes(l.id)) : txn.lines).map((l) => ({
          lineId: l.id,
          quantity: remainingOf(l),
        }));

    // A pristine full return (no explicit selector, nothing returned yet) reproduces
    // bill-level discount/charges and refunds the exact invoice total.
    const noExplicit = !body?.returns?.length && !body?.lineIds?.length;
    const pristineFull = noExplicit && priorReturns.length === 0;

    // Build credit-note lines at the RETURNED quantity, linked via sourceLineId, with per-line
    // discount prorated so a partial-quantity return refunds the correct amount.
    const built: TxnLineInput[] = [];
    let refundTotal = 0;
    const newlyReturned: Record<string, number> = {};
    for (const r of reqs) {
      const orig = lineById.get(r.lineId);
      if (!orig) throw new BadRequestException('Item line not found on this invoice');
      const origQty = Number(orig.quantity);
      const qty = Number(r.quantity);
      if (qty <= 0) continue;
      const remaining = remainingOf(orig) - (newlyReturned[orig.id] ?? 0);
      if (qty > remaining + 1e-6)
        throw new BadRequestException(`Cannot return ${qty} of ${orig.name}; only ${Math.max(0, remaining)} remain`);
      const unitPrice = Number(orig.unitPrice);
      const taxRate = Number(orig.taxRate);
      const hasPct = orig.discountPercent != null;
      const gross = unitPrice * qty;
      const discount = hasPct ? (gross * Number(orig.discountPercent)) / 100 : Number(orig.discountAmount) * (qty / origQty);
      const taxable = gross - discount;
      refundTotal += taxable + (taxable * taxRate) / 100;
      built.push({
        itemId: orig.itemId ?? undefined,
        name: orig.name,
        quantity: qty,
        unit: orig.unit,
        unitPrice,
        taxRate,
        ...(hasPct ? { discountPercent: Number(orig.discountPercent) } : { discountAmount: discount }),
        sourceLineId: orig.id,
      });
      newlyReturned[orig.id] = (newlyReturned[orig.id] ?? 0) + qty;
    }
    if (!built.length) throw new BadRequestException('Select at least one item and quantity to return');
    // Floor so the CASH refund never exceeds createTxn's recomputed total.
    refundTotal = Math.floor(refundTotal * 100) / 100;

    const creditNote = await this.core.createTxn(businessId, userId, {
      txnType: 'CREDIT_NOTE',
      branchId: txn.branchId ?? undefined,
      partyId: txn.partyId ?? undefined,
      partyName: txn.partyName ?? undefined,
      returnAgainstTxnId: txn.id,
      lines: built,
      roundOffEnabled: false,
      ...(pristineFull
        ? {
            discountPercent: txn.discountPercent != null ? Number(txn.discountPercent) : undefined,
            discountAmount: txn.discountPercent == null ? Number(txn.discountAmount) : undefined,
            additionalCharges: (txn.additionalCharges as { name: string; amount: number }[] | null) ?? undefined,
            payments: body?.payments ?? (cashRefund ? [{ paymentType: 'CASH', amount: Number(txn.total) }] : []),
          }
        : {
            payments: cashRefund ? [{ paymentType: 'CASH', amount: refundTotal }] : [],
          }),
      description: `${label} against ${txn.txnNumber}`,
    });

    // Mark REFUNDED once every line's cumulative returned qty reaches purchased qty.
    const allReturned = txn.lines.every(
      (l) => (alreadyReturned[l.id] ?? 0) + (newlyReturned[l.id] ?? 0) >= Number(l.quantity) - 1e-6,
    );
    if (allReturned) {
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
    body: {
      lineIds?: string[];
      returns?: { lineId: string; quantity: number }[];
      replacements: { itemId: string; quantity: number }[];
    },
  ) {
    if (!body.replacements?.length) throw new BadRequestException('Select at least one replacement item');
    const txn = await this.core.getTxn(businessId, id);
    if (txn.txnType !== 'SALE_INVOICE') throw new BadRequestException('Not a sale invoice');

    // 1. Return the selected quantities for cash.
    const creditNote = await this.refundInvoice(businessId, userId, id, {
      returns: body.returns,
      lineIds: body.lineIds,
      mode: 'REFUND',
    });

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
