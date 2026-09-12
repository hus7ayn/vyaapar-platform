import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Txn as TxnRow, TxnLine as TxnLineRow } from '@prisma/client';
import { CreateTxnInput, TxnCoreService, TxnLineInput, TxnPaymentInput } from '../txns/txn-core.service';
import { EventsGateway } from '../events/events.gateway';

type SaleBody = Omit<CreateTxnInput, 'txnType'>;

/** 2-dp money rounding. The POS return dialog uses the identical helper on the identical stored
 *  numbers, so what the cashier sees is what the server stores, to the paisa. */
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Quantities are stored as Decimal(14,3); quantise to that granularity before comparing or
 *  dividing by them, so a float tail can't slip past a cap and a sub-milli "quantity" can't
 *  divide by a stored zero. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const D = (v: number | string | Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);

@Injectable()
export class SaleService {
  constructor(private core: TxnCoreService, private events: EventsGateway) {}

  // ─── Sale Invoices (also powers POS) ───────────────────────────────────────

  async createInvoice(businessId: string, userId: string, body: SaleBody) {
    const create = (tx?: Prisma.TransactionClient) =>
      this.core.createTxn(businessId, userId, { ...body, txnType: 'SALE_INVOICE' }, tx);

    // No clientId and no party → nothing to guard, create directly (createTxn owns the transaction).
    let txn;
    if (!body.clientId && !body.partyId) {
      txn = await create();
    } else {
      // Idempotency + credit check + the create ALL run in ONE advisory-locked transaction on ONE
      // connection: createTxn writes on this same `tx` (see its `existingTx` param) instead of
      // opening a nested transaction that would need a second pooled connection — which, under the
      // POS's burst of concurrent requests, could not always be acquired and timed the sale out
      // ("A database error occurred"). The advisory lock is held until this transaction commits, so
      // a second request with the same clientId blocks, then sees the first invoice and returns it
      // instead of creating a duplicate — safe under a retried/double-submitted checkout, with no
      // reliance on a unique index (which a bulk `prisma db push` could fail to add on live data).
      txn = await this.core.prisma.$transaction(async (tx) => {
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

        return create(tx);
      }, { maxWait: 15000, timeout: 30000 });
    }

    // Emit AFTER the transaction commits so subscribers never read the row before it exists.
    this.events.emitOrderUpdate(businessId, txn.branchId ?? '', txn);
    return txn;
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

  // ─── Returns & exchanges ───────────────────────────────────────────────────
  //
  // THE canonical value of a return — the single formula both sides of the counter use.
  //
  //   goods(q) = Σ over the invoice's lines of   line.total × q(line) / line.quantity
  //   G        = goods(everything purchased)  =  Σ line.total
  //   paid(q)  = round2( invoice.total × goods(q) / G )
  //   VALUE    = paid(returned so far + this return) − paid(returned so far)
  //
  // `line.total` is the stored, tax-inclusive, line-discounted total of that line, and
  // `invoice.total` is literally what the customer handed over: goods − bill discount
  // + additional charges + round-off. Consequences, all of them things that used to be
  // wrong on one path or another:
  //
  //  • the bill discount (flat OR percentage), the additional charges and the round-off
  //    (up or down) are ALREADY inside invoice.total, so no branch can drop one, no branch
  //    can double-count one, and the same event at the counter can never refund two
  //    different amounts depending on which request shape the caller used;
  //  • the allocation is CUMULATIVE, so repeated partial returns telescope:
  //    Σ VALUE = paid(all) − paid(none) = invoice.total exactly — in any order, in any
  //    number of steps, and one call hands back precisely what ten calls would;
  //  • a 100 %-discounted bill has invoice.total 0, so every return of it is worth 0 and
  //    the comped item still comes back into stock (the old math drove the credit note
  //    negative and threw, so such an item could never be returned at all);
  //  • an exchange prices the replacement units off this SAME number (see exchangeInvoice),
  //    so the two legs can never disagree about what the returned goods were worth.
  //
  // Deliberately evaluated in plain JS numbers over the stored 2-dp figures: the POS return
  // dialog (apps/web/src/components/pos/return-dialog.tsx) runs the same expressions on the
  // same numbers in the same order, so the figure on the popup IS the figure the till books,
  // to the paisa. The exact Decimal arithmetic further down exists only to land the credit
  // note's own recomputed total on that number instead of a hair either side of it.

  /** Tax-inclusive value of `qty` units of an invoice line, taken from its STORED total. */
  private lineValue(line: { total: Prisma.Decimal | number; quantity: Prisma.Decimal | number }, qty: number) {
    const purchased = Number(line.quantity);
    const total = Number(line.total);
    if (!(purchased > 0) || !(qty > 0)) return 0;
    // Whole line → the stored total verbatim, so goods(all) is exactly Σ line.total and the
    // final return of a bill is exactly invoice.total with no division anywhere.
    return qty >= purchased ? total : (total * qty) / purchased;
  }

  /** goods(q). Summed in line-id order so the dialog's float sum matches this one term for term. */
  private goodsOf<T extends { id: string; total: Prisma.Decimal | number; quantity: Prisma.Decimal | number }>(
    lines: T[],
    qtyOf: (l: T) => number,
  ) {
    return [...lines]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .reduce((sum, l) => sum + this.lineValue(l, qtyOf(l)), 0);
  }

  /** paid(q). */
  private paidShare(invoiceTotal: number, goodsTotal: number, goods: number) {
    return goodsTotal > 0 ? round2(invoiceTotal * (goods / goodsTotal)) : 0;
  }

  /**
   * Serialise every return/exchange against one invoice. The already-returned tally used to be
   * read on the plain client BEFORE createTxn opened its own transaction, so two overlapping
   * requests (two terminals, or a cashier retrying a request that was still in flight) both saw
   * an empty tally and both committed — double stock in, double cash out. Holding this lock for
   * the whole transaction makes the second request read the first one's credit note and refuse.
   */
  private lockInvoiceReturns(tx: Prisma.TransactionClient, businessId: string, id: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`salereturn:${businessId}:${id}`}))`;
  }

  private async loadSaleInvoice(tx: Prisma.TransactionClient, businessId: string, id: string) {
    const txn = await tx.txn.findFirst({ where: { id, businessId, deletedAt: null }, include: { lines: true } });
    if (!txn) throw new NotFoundException('Sale invoice not found');
    if (txn.txnType !== 'SALE_INVOICE') throw new BadRequestException('Not a sale invoice');
    return txn;
  }

  /**
   * Build and commit the credit note for a set of returned quantities, on the caller's
   * transaction. Returns the note plus the two numbers an exchange needs to price its other
   * leg off the identical arithmetic: `value` (what this return is worth — see above) and
   * `returnedGoods` (goods(this return), the undiscounted tax-inclusive value of those units).
   */
  private async postReturn(
    tx: Prisma.TransactionClient,
    businessId: string,
    userId: string,
    txn: TxnRow & { lines: TxnLineRow[] },
    body: {
      payments?: TxnPaymentInput[];
      lineIds?: string[];
      returns?: { lineId: string; quantity: number }[];
      cashRefund?: boolean;
      mode?: 'REFUND' | 'EXCHANGE';
      clientId?: string;
    },
  ) {
    // Exact already-returned quantity per original line: prefer the sourceLineId link on
    // prior credit-note lines; fall back to signature matching for legacy rows (null link).
    const priorReturns = await tx.txn.findMany({
      where: { businessId, txnType: 'CREDIT_NOTE', returnAgainstTxnId: txn.id, deletedAt: null },
      include: { lines: true },
    });
    const sig = (l: { itemId: string | null; name: string; unitPrice: Prisma.Decimal | number }) =>
      `${l.itemId ?? l.name}|${Number(l.unitPrice)}`;
    const already: Record<string, number> = {};
    const legacyBySig: Record<string, number> = {};
    for (const cn of priorReturns)
      for (const l of cn.lines) {
        if (l.sourceLineId) already[l.sourceLineId] = (already[l.sourceLineId] ?? 0) + Number(l.quantity);
        else legacyBySig[sig(l)] = (legacyBySig[sig(l)] ?? 0) + Number(l.quantity);
      }
    for (const l of txn.lines) {
      const prior = already[l.id] ?? 0;
      const cap = Number(l.quantity) - prior;
      const take = Math.min(Math.max(0, legacyBySig[sig(l)] ?? 0), Math.max(0, cap));
      already[l.id] = prior + take;
      if (legacyBySig[sig(l)] != null) legacyBySig[sig(l)] -= take;
    }
    const remainingOf = (l: { id: string; quantity: Prisma.Decimal | number }) =>
      round3(Number(l.quantity) - (already[l.id] ?? 0));

    const lineById = new Map(txn.lines.map((l) => [l.id, l]));
    const cashRefund = body.cashRefund !== false && body.mode !== 'EXCHANGE';
    const label = body.mode === 'EXCHANGE' ? 'Exchange' : 'Return';

    // Resolve the requested (lineId, quantity) returns. No selector = every remaining unit,
    // which now simply falls out of the formula as `value` = the whole invoice total.
    const reqs: { lineId: string; quantity: number }[] = body.returns?.length
      ? body.returns
      : (body.lineIds?.length ? txn.lines.filter((l) => body.lineIds!.includes(l.id)) : txn.lines).map((l) => ({
          lineId: l.id,
          quantity: remainingOf(l),
        }));

    // Credit-note lines at the RETURNED quantity, linked via sourceLineId, with the line's own
    // discount prorated. `cnSubtotal`/`cnTax` are an exact Decimal mirror of what buildLines
    // will recompute from these very inputs — same operations, same accumulation order.
    const built: TxnLineInput[] = [];
    const now: Record<string, number> = {};
    let cnSubtotal = D(0);
    let cnTax = D(0);

    for (const r of reqs) {
      const orig = lineById.get(r.lineId);
      if (!orig) throw new BadRequestException('Item line not found on this invoice');
      // Quantities are stored at 3 decimals, so quantise the request to the same granularity:
      // a float tail can no longer slip past the cap, and a sub-milli "quantity" (which used to
      // pass the cap check and then divide by a zero stored quantity, poisoning the whole note
      // with NaN) is now simply not a quantity at all.
      const asked = Number(r.quantity);
      const qty = Number.isFinite(asked) ? round3(asked) : 0;
      if (qty <= 0) continue;
      const origQty = Number(orig.quantity);
      if (!(origQty > 0)) throw new BadRequestException(`${orig.name} has no returnable quantity`);
      const remaining = round3(remainingOf(orig) - (now[orig.id] ?? 0));
      if (qty > remaining)
        throw new BadRequestException(`Cannot return ${qty} of ${orig.name}; only ${Math.max(0, remaining)} remain`);

      const unitPrice = Number(orig.unitPrice);
      const taxRate = Number(orig.taxRate);
      const qtyD = D(qty);
      const grossD = D(unitPrice).mul(qtyD);
      const prorataD = orig.discountPercent != null
        ? grossD.mul(D(orig.discountPercent)).div(100)
        : D(orig.discountAmount).mul(qtyD).div(D(origQty));
      // Quantise the credit-note line's TAXABLE value to the paisa and hand buildLines the
      // discount that produces it. That pins the note's own subtotal at 2 dp and its tax at 6,
      // few enough decimals that `adjust` below survives the round trip through `number` that
      // CreateTxnInput forces — which is what makes the note's total land exactly on `value`.
      const taxableD = grossD.sub(prorataD).toDecimalPlaces(2);
      cnSubtotal = cnSubtotal.add(taxableD);
      cnTax = cnTax.add(taxableD.mul(D(taxRate)).div(100));

      built.push({
        itemId: orig.itemId ?? undefined,
        name: orig.name,
        quantity: qty,
        unit: orig.unit,
        unitPrice,
        taxRate,
        discountAmount: grossD.sub(taxableD).toNumber(),
        sourceLineId: orig.id,
      });
      now[orig.id] = round3((now[orig.id] ?? 0) + qty);
    }
    if (!built.length) throw new BadRequestException('Select at least one item and quantity to return');

    const invoiceTotal = Number(txn.total);
    const goodsTotal = this.goodsOf(txn.lines, (l) => Number(l.quantity));
    const before = this.paidShare(invoiceTotal, goodsTotal, this.goodsOf(txn.lines, (l) => already[l.id] ?? 0));
    const after = this.paidShare(
      invoiceTotal,
      goodsTotal,
      this.goodsOf(txn.lines, (l) => (already[l.id] ?? 0) + (now[l.id] ?? 0)),
    );
    const value = Math.max(0, round2(after - before));
    const returnedGoods = this.goodsOf(txn.lines, (l) => now[l.id] ?? 0);

    // Land the note's own recomputed total exactly on `value`. The lines above carry the goods
    // at bill prices; the difference is this return's share of everything the bill added or took
    // off on top. A shortfall rides as a bill-level discount (the bill discount's share), an
    // excess as an additional charge (the additional charges' and round-off's share). Because
    // `value` is 2 dp and the mirror above is exact, the note is created PAID with no residual —
    // no more sub-rupee party-ledger debts from a floored cash payment.
    const adjust = D(value).sub(cnSubtotal.add(cnTax));
    const payments = body.payments?.length
      ? body.payments
      : cashRefund && value > 0
        ? [{ paymentType: 'CASH', amount: value }]
        : [];

    const creditNote = await this.core.createTxn(
      businessId,
      userId,
      {
        txnType: 'CREDIT_NOTE',
        branchId: txn.branchId ?? undefined,
        partyId: txn.partyId ?? undefined,
        partyName: txn.partyName ?? undefined,
        returnAgainstTxnId: txn.id,
        clientId: body.clientId,
        lines: built,
        roundOffEnabled: false,
        ...(adjust.lt(0) ? { discountAmount: adjust.neg().toNumber() } : {}),
        ...(adjust.gt(0) ? { additionalCharges: [{ name: 'Charges & round-off', amount: adjust.toNumber() }] } : {}),
        payments,
        description: `${label} against ${txn.txnNumber}`,
      },
      tx,
    );

    // Mark REFUNDED once every line's cumulative returned qty reaches purchased qty. That stamp
    // is now honest: a full return hands back invoice.total, charges and round-off included.
    const allReturned = txn.lines.every((l) => round3((already[l.id] ?? 0) + (now[l.id] ?? 0)) >= Number(l.quantity));
    if (allReturned) await tx.txn.update({ where: { id: txn.id }, data: { status: 'REFUNDED' } });

    return { creditNote, value, returnedGoods };
  }

  /**
   * Return an invoice as a credit note, at QUANTITY granularity. `returns:[{lineId,quantity}]`
   * returns exactly those units; `lineIds` returns each named line's remaining quantity; no
   * selector = every remaining unit. Each credit-note line links back to its source invoice line
   * (sourceLineId) so cumulative returned quantity is exact and a line can never be over-returned.
   * The refund is always the canonical VALUE above, so the "full return" case is no longer a
   * separate branch that could disagree with the piecemeal one. mode EXCHANGE / cashRefund:false
   * records store credit (no cash out); REFUND (default) pays cash back. Pass `clientId` to make
   * a retried request idempotent instead of returning the goods twice.
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
      clientId?: string;
    },
  ) {
    return this.core.prisma.$transaction(
      async (tx) => {
        await this.lockInvoiceReturns(tx, businessId, id);
        if (body?.clientId) {
          const existing = await tx.txn.findFirst({
            where: { businessId, txnType: 'CREDIT_NOTE', clientId: body.clientId, returnAgainstTxnId: id, deletedAt: null },
            include: { lines: true, party: true },
          });
          if (existing) return existing;
        }
        const txn = await this.loadSaleInvoice(tx, businessId, id);
        const { creditNote } = await this.postReturn(tx, businessId, userId, txn, body ?? {});
        return creditNote;
      },
      { maxWait: 15000, timeout: 30000 },
    );
  }

  /**
   * Exchange: return the selected units for cash, then ring up the replacement items as a new
   * fully-paid sale. Net cash = new sale total − refund.
   *
   * ALL-OR-NOTHING, deliberately. Both legs run on one transaction, so a replacement that can't
   * be sold (out of stock, priced below cost) rolls the refund back with it. Before this, leg 1
   * committed on its own — stock in, cash out, invoice stamped REFUNDED — and a leg-2 failure
   * left a refund for goods the shop still hadn't handed over, with the retry then blocked by
   * the return cap leg 1 had just consumed: unrecoverable from the till. A rolled-back exchange
   * leaves the invoice exactly as it was, so the cashier simply picks a different replacement.
   *
   * Pricing: the units coming back are worth `value` (the canonical formula above) and that is
   * the ONLY price they have. An exchange honours it as an ALLOWANCE — one unit at the bill's
   * own effective rate for every unit of that item on this credit note, taken from the very line
   * it came back from. Anything beyond the allowance, and any genuinely different product, is an
   * ordinary new sale at today's catalogue price. `unitPrice` stays the rate printed on the
   * original bill and the difference rides as a line discount, so the replacement bill reads
   * like the original one.
   */
  async exchangeInvoice(
    businessId: string,
    userId: string,
    id: string,
    body: {
      lineIds?: string[];
      returns?: { lineId: string; quantity: number }[];
      replacements: { itemId: string; quantity: number }[];
      clientId?: string;
    },
  ) {
    if (!body.replacements?.length) throw new BadRequestException('Select at least one replacement item');
    // Validate replacements BEFORE anything is written. This endpoint is interface-typed, so the
    // global ValidationPipe skips it; a missing/"abc"/0/negative quantity used to be coerced to
    // 1 (invoicing, charging for and shipping a unit nobody asked for) or silently dropped.
    const replacements = body.replacements.map((r) => {
      if (!r?.itemId || typeof r.itemId !== 'string') throw new BadRequestException('Replacement item is required');
      const qty = round3(Number(r.quantity));
      if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('Replacement quantity must be a positive number');
      return { itemId: r.itemId, quantity: qty };
    });

    return this.core.prisma.$transaction(
      async (tx) => {
        await this.lockInvoiceReturns(tx, businessId, id);
        // Idempotency: a retried exchange (double tap, or a POS retry after a pooled-connection
        // timeout) returns the pair the first call committed instead of returning goods twice.
        if (body.clientId) {
          const existing = await tx.txn.findFirst({
            where: { businessId, txnType: 'CREDIT_NOTE', clientId: body.clientId, returnAgainstTxnId: id, deletedAt: null },
            include: { lines: true, party: true },
          });
          if (existing) {
            const priorSale = await tx.txn.findFirst({
              where: { businessId, txnType: 'SALE_INVOICE', clientId: `${body.clientId}:exchange`, deletedAt: null },
              include: { lines: true, party: true },
            });
            return { creditNote: existing, sale: priorSale };
          }
        }

        const txn = await this.loadSaleInvoice(tx, businessId, id);

        // 1. Return the selected quantities for cash.
        const { creditNote, value, returnedGoods } = await this.postReturn(tx, businessId, userId, txn, {
          returns: body.returns,
          lineIds: body.lineIds,
          mode: 'REFUND',
          clientId: body.clientId,
        });

        // 2. Price the replacements.
        const items = await tx.item.findMany({ where: { id: { in: replacements.map((r) => r.itemId) }, businessId } });
        const itemMap = new Map(items.map((i) => [i.id, i]));

        // `k` is what the customer really paid per rupee of bill-price goods on this return:
        // value / goods(this return). With no charges and no round-off it is exactly
        // (1 − billDiscount/goods); with them it also carries their share, which is precisely
        // why the two legs of a like-for-like swap cancel to zero instead of leaking the
        // difference in either direction.
        const k = returnedGoods > 0 ? value / returnedGoods : 0;
        const origById = new Map(txn.lines.map((l) => [l.id, l]));
        type Allowance = { qty: number; unitPrice: number; netUnitPrice: number; taxRate: number };
        const allowances = new Map<string, Allowance[]>();
        for (const cn of creditNote.lines) {
          const orig = cn.sourceLineId ? origById.get(cn.sourceLineId) : undefined;
          const qty = Number(cn.quantity);
          const soldQty = orig ? Number(orig.quantity) : 0;
          if (!orig?.itemId || qty <= 0 || !(soldQty > 0)) continue;
          const discountPerUnit = orig.discountPercent != null
            ? (Number(orig.unitPrice) * Number(orig.discountPercent)) / 100
            : Number(orig.discountAmount ?? 0) / soldQty;
          const list = allowances.get(orig.itemId) ?? [];
          list.push({
            qty,
            unitPrice: Number(orig.unitPrice),
            // The rate the customer was really charged: the line discount, then this line's
            // share of everything the bill did on top. Rounded to the paisa here and nowhere
            // else, so the dialog's identical arithmetic lands on the identical number.
            netUnitPrice: round2((Number(orig.unitPrice) - discountPerUnit) * k),
            taxRate: Number(orig.taxRate),
          });
          allowances.set(orig.itemId, list);
        }
        // Dearest first (ties broken deterministically), so neither the order the credit-note
        // lines come back in nor the dialog's own ordering can change the price.
        for (const list of allowances.values())
          list.sort((a, b) => b.netUnitPrice - a.netUnitPrice || b.taxRate - a.taxRate || b.unitPrice - a.unitPrice);

        // Only the lines re-issuing an already-charged price are exempted from the below-cost
        // guard; units sold at today's catalogue rate are an ordinary sale and stay guarded.
        const lines: TxnLineInput[] = [];
        const belowCostAllowed = new Set<TxnLineInput>();
        for (const r of replacements) {
          const item = itemMap.get(r.itemId);
          if (!item) throw new BadRequestException('Replacement item not found');
          let left = r.quantity;
          for (const a of allowances.get(r.itemId) ?? []) {
            if (left <= 0) break;
            const take = Math.min(left, a.qty);
            if (take <= 0) continue;
            a.qty = round3(a.qty - take);
            left = round3(left - take);
            const line: TxnLineInput = {
              itemId: item.id,
              name: item.name,
              quantity: take,
              unit: item.baseUnit,
              unitPrice: a.unitPrice,
              discountAmount: round2((a.unitPrice - a.netUnitPrice) * take),
              taxRate: a.taxRate,
            };
            lines.push(line);
            belowCostAllowed.add(line);
          }
          if (left > 0) {
            lines.push({
              itemId: item.id,
              name: item.name,
              quantity: left,
              unit: item.baseUnit,
              unitPrice: Number(item.salePrice),
              discountAmount: 0,
              taxRate: Number(item.taxRate),
            });
          }
        }
        if (!lines.length) throw new BadRequestException('Select at least one replacement item');

        // Exact Decimal mirror of buildLines + computeTotals (roundOffEnabled false, no bill-level
        // discount or charges) over the very numbers posted below — same operations, same
        // accumulation order. A float running total can land a hair ABOVE the Decimal total
        // createTxn recomputes, and then the cash payment trips "Paid amount exceeds total";
        // paying the exact total also keeps the exchange sale PAID instead of a paisa short.
        let saleSubtotal = D(0);
        let saleTax = D(0);
        for (const l of lines) {
          const taxable = D(l.unitPrice).mul(D(l.quantity)).sub(D(l.discountAmount ?? 0));
          saleSubtotal = saleSubtotal.add(taxable);
          saleTax = saleTax.add(taxable.mul(D(l.taxRate ?? 0)).div(100));
        }
        const saleTotal = saleSubtotal.add(saleTax);
        // Decimal → number is exact at money scale; clamp anyway so `paid` can never exceed total.
        let paid = saleTotal.toNumber();
        if (D(paid).gt(saleTotal)) paid = Math.floor(paid * 100) / 100;

        const sale = await this.core.createTxn(
          businessId,
          userId,
          {
            txnType: 'SALE_INVOICE',
            branchId: txn.branchId ?? undefined,
            partyId: txn.partyId ?? undefined,
            partyName: txn.partyName ?? undefined,
            clientId: body.clientId ? `${body.clientId}:exchange` : undefined,
            lines,
            roundOffEnabled: false,
            payments: [{ paymentType: 'CASH', amount: paid }],
            description: `Exchange for ${txn.txnNumber}`,
          },
          tx,
          { belowCostAllowed },
        );
        return { creditNote, sale };
      },
      { maxWait: 15000, timeout: 30000 },
    );
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
