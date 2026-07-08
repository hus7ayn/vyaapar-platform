import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchWarehouse } from '../inventory/warehouse.util';
import {
  DEFAULT_PREFIXES,
  LEDGER_ENTRY_TYPE,
  STOCK_EFFECT,
  STOCK_MOVEMENT_TYPE,
  TxnType,
} from './txn.constants';

type Tx = Prisma.TransactionClient;
const D = (v: number | string | Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);

export interface TxnLineInput {
  itemId?: string;
  name?: string;
  hsnCode?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  taxRate?: number;
}

export interface TxnPaymentInput {
  id?: string; // present when restoring an existing TxnPayment row (avoids re-creating it)
  paymentType: string; // CASH | CHEQUE | BANK | UPI | CARD | WALLET | DEBT
  bankAccountId?: string;
  amount: number;
  referenceNo?: string;
}

export interface AllocationInput {
  id?: string; // present when restoring an existing BillWiseAllocation row (avoids re-creating it)
  againstTxnId: string;
  amount: number;
  discountAmount?: number;
}

export interface CreateTxnInput {
  txnType: TxnType;
  branchId?: string;
  partyId?: string;
  partyName?: string;
  expenseCategoryId?: string;
  date?: string;
  dueDate?: string;
  stateOfSupply?: string;
  lines?: TxnLineInput[];
  discountPercent?: number;
  discountAmount?: number; // bill-level discount
  additionalCharges?: { name: string; amount: number }[];
  roundOffEnabled?: boolean;
  total?: number; // for line-less txns (payments, expenses without items)
  payments?: TxnPaymentInput[];
  allocations?: AllocationInput[]; // bill-wise allocation for PAYMENT_IN/OUT
  description?: string;
  imageUrl?: string;
  status?: string; // e.g. HELD for POS
  sourceTxnId?: string;
  returnAgainstTxnId?: string;
  p2pToPartyId?: string;
  clientId?: string;
  pointsRedeemed?: number;
}

@Injectable()
export class TxnCoreService {
  constructor(public prisma: PrismaService) {}

  // ─── Numbering ─────────────────────────────────────────────────────────────

  async nextNumber(tx: Tx, businessId: string, txnType: TxnType, branchId?: string | null): Promise<{ prefix: string; txnNumber: string }> {
    const shopId = branchId ?? (await tx.branch.findFirst({ where: { businessId, isDefault: true, deletedAt: null }, select: { id: true } }))?.id;
    if (!shopId) throw new BadRequestException('No shop found for transaction numbering');
    const seq = await tx.txnNumberSequence.upsert({
      where: { businessId_branchId_txnType: { businessId, branchId: shopId, txnType } },
      create: { businessId, branchId: shopId, txnType, prefix: DEFAULT_PREFIXES[txnType], nextNumber: 2 },
      update: { nextNumber: { increment: 1 } },
    });
    const n = seq.nextNumber - 1 || 1;
    const prefix = seq.prefix || DEFAULT_PREFIXES[txnType];
    return { prefix, txnNumber: `${prefix}-${String(n).padStart(3, '0')}` };
  }

  // ─── Totals computation ────────────────────────────────────────────────────

  async buildLines(businessId: string, lines: TxnLineInput[], priceField: 'sale' | 'purchase') {
    const itemIds = lines.map((l) => l.itemId).filter(Boolean) as string[];
    const items = itemIds.length
      ? await this.prisma.item.findMany({ where: { id: { in: itemIds }, businessId } })
      : [];
    const itemMap = new Map(items.map((i) => [i.id, i]));

    let subtotal = D(0);
    let taxTotal = D(0);
    const built: (Omit<Prisma.TxnLineCreateWithoutTxnInput, 'txn'> & { itemId?: string })[] = [];

    for (const l of lines) {
      const item = l.itemId ? itemMap.get(l.itemId) : undefined;
      if (l.itemId && !item) throw new BadRequestException(`Item ${l.itemId} not found`);
      const qty = D(l.quantity);
      if (qty.lte(0)) throw new BadRequestException('Quantity must be positive');
      const defaultPrice = item ? (priceField === 'sale' ? item.salePrice : item.purchasePrice) : D(0);
      const unitPrice = l.unitPrice != null ? D(l.unitPrice) : D(defaultPrice);
      const gross = unitPrice.mul(qty);
      const discPct = l.discountPercent != null ? D(l.discountPercent) : null;
      const discount = discPct ? gross.mul(discPct).div(100) : D(l.discountAmount ?? 0);
      const taxable = gross.sub(discount);
      const taxRate = D(l.taxRate ?? (item ? item.taxRate : 0));
      const tax = taxable.mul(taxRate).div(100);
      subtotal = subtotal.add(taxable);
      taxTotal = taxTotal.add(tax);
      built.push({
        itemId: l.itemId,
        name: l.name ?? item?.name ?? 'Item',
        hsnCode: l.hsnCode ?? item?.hsnCode ?? null,
        quantity: qty,
        unit: l.unit ?? item?.baseUnit ?? 'PCS',
        unitPrice,
        costPrice: item ? item.purchasePrice : null,
        discountPercent: discPct,
        discountAmount: discount,
        taxRate,
        taxAmount: tax,
        total: taxable.add(tax),
      });
    }
    return { built, subtotal, taxTotal, itemMap };
  }

  computeTotals(opts: {
    subtotal: Prisma.Decimal;
    taxTotal: Prisma.Decimal;
    discountPercent?: number;
    discountAmount?: number;
    additionalCharges?: { name: string; amount: number }[];
    roundOffEnabled?: boolean;
  }) {
    const billDiscount = opts.discountPercent != null
      ? opts.subtotal.add(opts.taxTotal).mul(D(opts.discountPercent)).div(100)
      : D(opts.discountAmount ?? 0);
    const charges = (opts.additionalCharges ?? []).reduce((s, c) => s.add(D(c.amount)), D(0));
    const raw = opts.subtotal.add(opts.taxTotal).sub(billDiscount).add(charges);
    let roundOff = D(0);
    let total = raw;
    if (opts.roundOffEnabled !== false) {
      const rounded = raw.toDecimalPlaces(0);
      roundOff = rounded.sub(raw);
      total = rounded;
    }
    return { billDiscount, charges, roundOff, total };
  }

  // ─── Posting effects (used inside a prisma transaction) ───────────────────

  async applyStock(
    tx: Tx,
    businessId: string,
    branchId: string | null | undefined,
    txnType: TxnType,
    reference: string,
    lines: { itemId?: string | null; quantity: Prisma.Decimal | number }[],
    invert = false,
  ) {
    const effect = STOCK_EFFECT[txnType];
    if (!effect) return;
    const direction = invert ? -effect : effect;

    for (const line of lines) {
      if (!line.itemId) continue;
      const item = await tx.item.findUnique({ where: { id: line.itemId } });
      if (!item || !item.trackStock || item.itemType === 'SERVICE') continue;
      const qty = D(line.quantity).mul(direction);

      await tx.item.update({
        where: { id: item.id },
        data: { currentStock: { increment: qty } },
      });

      if (branchId) {
        const warehouse = await resolveBranchWarehouse(tx, businessId, branchId);
        if (warehouse) {
          const stock = await tx.stockLevel.findFirst({
            where: { itemId: item.id, warehouseId: warehouse.id },
          });
          if (stock) {
            await tx.stockLevel.update({ where: { id: stock.id }, data: { quantity: stock.quantity.add(qty) } });
          } else {
            await tx.stockLevel.create({
              data: { itemId: item.id, warehouseId: warehouse.id, branchId, quantity: qty },
            });
          }
          await tx.stockMovement.create({
            data: {
              businessId,
              itemId: item.id,
              warehouseId: warehouse.id,
              branchId,
              type: invert ? `REVERSE_${STOCK_MOVEMENT_TYPE[txnType]}` : STOCK_MOVEMENT_TYPE[txnType]!,
              quantity: qty,
              reference,
            },
          });
        }
      }
    }
  }

  /** Signed party-balance delta for a txn. Positive = receivable increase. */
  partyDelta(txnType: TxnType, total: Prisma.Decimal, balance: Prisma.Decimal): Prisma.Decimal {
    switch (txnType) {
      case 'SALE_INVOICE': return balance; // unpaid portion becomes receivable
      case 'CREDIT_NOTE': return balance.neg(); // unpaid refund owed back to customer
      case 'PURCHASE_BILL': return balance.neg(); // unpaid portion becomes payable
      case 'DEBIT_NOTE': return balance; // unpaid refund owed back to us
      case 'PAYMENT_IN': return total.neg();
      case 'PAYMENT_OUT': return total;
      default: return D(0);
    }
  }

  async applyPartyBalance(
    tx: Tx,
    businessId: string,
    branchId: string | null | undefined,
    txnId: string,
    txnType: TxnType,
    partyId: string,
    delta: Prisma.Decimal,
    description: string,
    entryDate: Date,
    invert = false,
  ) {
    const d = invert ? delta.neg() : delta;
    if (d.isZero()) return;
    const party = await tx.party.update({
      where: { id: partyId },
      data: { currentBalance: { increment: d } },
    });
    await tx.partyLedgerEntry.create({
      data: {
        businessId,
        branchId,
        partyId,
        txnId,
        entryType: invert ? `REVERSE_${LEDGER_ENTRY_TYPE[txnType] ?? txnType}` : (LEDGER_ENTRY_TYPE[txnType] ?? txnType),
        amount: d,
        balance: party.currentBalance,
        description,
        entryDate,
      },
    });
  }

  /**
   * Money-account effect of payments.
   * inbound=true → money comes in (sale receipts, payment-in, debit-note refunds).
   * Cheque payments create an open Cheque and do NOT hit any account until deposited.
   */
  async applyPayments(
    tx: Tx,
    businessId: string,
    branchId: string | null | undefined,
    txnId: string,
    txnType: TxnType,
    partyName: string | null | undefined,
    payments: TxnPaymentInput[],
    inbound: boolean,
    invert = false,
  ) {
    for (const p of payments) {
      if (p.paymentType === 'DEBT') continue; // credit sale — no money movement
      const amount = D(p.amount);
      if (amount.lte(0)) continue;

      if (invert) {
        // Reverse: delete payment rows handled by cascade; just undo balances/cheques
        if (p.paymentType === 'CHEQUE') {
          await tx.cheque.deleteMany({ where: { businessId, txnPayment: { txnId } } });
        } else {
          const account = await this.resolveMoneyAccount(tx, businessId, branchId, p);
          if (account) {
            await tx.bankAccount.update({
              where: { id: account.id },
              data: { balance: { increment: inbound ? amount.neg() : amount } },
            });
          }
        }
        continue;
      }

      if (p.id) {
        // Restore: the TxnPayment row was never deleted by deleteTxn's invert branch above,
        // so just re-apply the cheque/balance effect against the existing row.
        if (p.paymentType === 'CHEQUE') {
          await tx.cheque.create({
            data: {
              businessId,
              branchId: branchId ?? null,
              txnPaymentId: p.id,
              partyName,
              amount,
              direction: inbound ? 'RECEIVED' : 'PAID',
              chequeNumber: p.referenceNo,
              description: `${txnType} cheque`,
            },
          });
        } else {
          const account = await this.resolveMoneyAccount(tx, businessId, branchId, p);
          if (account) {
            await tx.bankAccount.update({
              where: { id: account.id },
              data: { balance: { increment: inbound ? amount : amount.neg() } },
            });
          }
        }
        continue;
      }

      const payment = await tx.txnPayment.create({
        data: {
          txnId,
          paymentType: p.paymentType,
          bankAccountId: p.paymentType === 'CHEQUE' ? null : p.bankAccountId,
          amount,
          referenceNo: p.referenceNo,
        },
      });

      if (p.paymentType === 'CHEQUE') {
        await tx.cheque.create({
          data: {
            businessId,
            branchId: branchId ?? null,
            txnPaymentId: payment.id,
            partyName,
            amount,
            direction: inbound ? 'RECEIVED' : 'PAID',
            chequeNumber: p.referenceNo,
            description: `${txnType} cheque`,
          },
        });
      } else {
        const account = await this.resolveMoneyAccount(tx, businessId, branchId, p);
        if (account) {
          await tx.bankAccount.update({
            where: { id: account.id },
            data: { balance: { increment: inbound ? amount : amount.neg() } },
          });
        }
      }
    }
  }

  private async resolveMoneyAccount(tx: Tx, businessId: string, branchId: string | null | undefined, p: TxnPaymentInput) {
    const branchFilter = branchId ? { branchId } : {};
    if (p.bankAccountId) {
      return tx.bankAccount.findFirst({ where: { id: p.bankAccountId, businessId, ...branchFilter } });
    }
    if (p.paymentType === 'CASH') {
      let cash = await tx.bankAccount.findFirst({ where: { businessId, accountType: 'CASH', ...branchFilter } });
      if (!cash && branchId) {
        cash = await tx.bankAccount.create({
          data: { businessId, branchId, name: 'Cash In Hand', accountType: 'CASH' },
        });
      }
      if (!cash) {
        cash = await tx.bankAccount.findFirst({ where: { businessId, accountType: 'CASH' } });
      }
      return cash;
    }
    return tx.bankAccount.findFirst({
      where: { businessId, accountType: 'BANK', ...branchFilter },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Bill-wise allocation: apply payment amounts against specific invoices/bills. */
  async applyAllocations(
    tx: Tx,
    businessId: string,
    paymentTxnId: string,
    allocations: AllocationInput[],
    invert = false,
  ) {
    for (const a of allocations) {
      const against = await tx.txn.findFirst({ where: { id: a.againstTxnId, businessId } });
      if (!against) throw new BadRequestException(`Transaction ${a.againstTxnId} not found`);
      const amount = D(a.amount).add(D(a.discountAmount ?? 0)).mul(invert ? -1 : 1);
      const newPaid = against.paidAmount.add(amount);
      const newBalance = against.total.sub(newPaid);
      await tx.txn.update({
        where: { id: against.id },
        data: {
          paidAmount: newPaid,
          balance: newBalance,
          status: newBalance.lte(0) ? 'PAID' : newPaid.gt(0) ? 'PARTIAL' : 'OPEN',
        },
      });
      if (!invert && !a.id) {
        await tx.billWiseAllocation.create({
          data: {
            businessId,
            paymentTxnId,
            againstTxnId: a.againstTxnId,
            amount: D(a.amount),
            discountAmount: D(a.discountAmount ?? 0),
          },
        });
      }
    }
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async createTxn(businessId: string, userId: string | null, input: CreateTxnInput) {
    const txnType = input.txnType;
    const isSaleSide = ['SALE_INVOICE', 'CREDIT_NOTE', 'SALE_ORDER', 'DELIVERY_CHALLAN', 'ESTIMATE'].includes(txnType);
    const isPaymentTxn = txnType === 'PAYMENT_IN' || txnType === 'PAYMENT_OUT';
    const hasLines = !!input.lines?.length;

    if (!hasLines && !isPaymentTxn && txnType !== 'EXPENSE' && txnType !== 'P2P_TRANSFER') {
      throw new BadRequestException(`${txnType} requires at least one item line`);
    }

    let party: { id: string; name: string } | null = null;
    if (input.partyId) {
      party = await this.prisma.party.findFirst({ where: { id: input.partyId, businessId, deletedAt: null } });
      if (!party) throw new BadRequestException('Party not found');
    }

    const { built, subtotal, taxTotal } = hasLines
      ? await this.buildLines(businessId, input.lines!, isSaleSide ? 'sale' : 'purchase')
      : { built: [], subtotal: D(input.total ?? 0), taxTotal: D(0) };

    const { billDiscount, roundOff, total } = hasLines
      ? this.computeTotals({
          subtotal,
          taxTotal,
          discountPercent: input.discountPercent,
          discountAmount: input.discountAmount,
          additionalCharges: input.additionalCharges,
          roundOffEnabled: input.roundOffEnabled,
        })
      : { billDiscount: D(0), roundOff: D(0), total: D(input.total ?? 0) };

    if (total.lt(0)) throw new BadRequestException('Total cannot be negative');

    const payments = (input.payments ?? []).filter((p) => D(p.amount).gt(0));
    if (isPaymentTxn) {
      const paymentsTotal = payments.reduce((s, p) => s.add(D(p.amount)), D(0));
      if (!paymentsTotal.equals(total)) throw new BadRequestException('Sum of payments must equal total');
    }
    const paidAmount = isPaymentTxn
      ? total
      : payments.filter((p) => p.paymentType !== 'DEBT').reduce((s, p) => s.add(D(p.amount)), D(0));
    if (!isPaymentTxn && paidAmount.gt(total)) throw new BadRequestException('Paid amount exceeds total');
    const balance = total.sub(paidAmount);

    const isOrderLike = ['SALE_ORDER', 'PURCHASE_ORDER', 'ESTIMATE', 'DELIVERY_CHALLAN'].includes(txnType);
    const isHeld = input.status === 'HELD';
    const status = input.status ?? (
      isOrderLike ? 'ORDER_OPEN' : isPaymentTxn ? 'PAID' : balance.lte(0) ? 'PAID' : paidAmount.gt(0) ? 'PARTIAL' : 'OPEN'
    );

    const date = input.date ? new Date(input.date) : new Date();

    return this.prisma.$transaction(async (tx) => {
      const { prefix, txnNumber } = await this.nextNumber(tx, businessId, txnType, input.branchId);

      const txn = await tx.txn.create({
        data: {
          businessId,
          branchId: input.branchId,
          txnType,
          prefix,
          txnNumber,
          partyId: party?.id,
          partyName: input.partyName ?? party?.name,
          expenseCategoryId: input.expenseCategoryId,
          date,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          stateOfSupply: input.stateOfSupply,
          subtotal,
          discountPercent: input.discountPercent != null ? D(input.discountPercent) : null,
          discountAmount: billDiscount,
          taxAmount: taxTotal,
          additionalCharges: input.additionalCharges?.length ? input.additionalCharges : undefined,
          roundOff,
          total,
          paidAmount,
          balance,
          status,
          description: input.description,
          imageUrl: input.imageUrl,
          sourceTxnId: input.sourceTxnId,
          returnAgainstTxnId: input.returnAgainstTxnId,
          p2pToPartyId: input.p2pToPartyId,
          pointsRedeemed: input.pointsRedeemed ?? 0,
          createdById: userId,
          clientId: input.clientId,
          heldAt: isHeld ? new Date() : null,
          lines: { create: built.map(({ itemId, ...rest }) => ({ ...rest, item: itemId ? { connect: { id: itemId } } : undefined })) },
        },
        include: { lines: true, party: true },
      });

      if (!isHeld && status !== 'HELD') {
        await this.postEffects(tx, businessId, txn, input, payments);
      }

      return txn;
    });
  }

  /** Apply all side effects of an already-created txn record. */
  async postEffects(
    tx: Tx,
    businessId: string,
    txn: { id: string; txnType: string; txnNumber: string; branchId: string | null; partyId: string | null; partyName: string | null; total: Prisma.Decimal; balance: Prisma.Decimal; date: Date; p2pToPartyId?: string | null; lines?: { itemId: string | null; quantity: Prisma.Decimal }[] },
    input: { allocations?: AllocationInput[] },
    payments: TxnPaymentInput[],
    invert = false,
  ) {
    const txnType = txn.txnType as TxnType;

    // 1. Stock
    if (txn.lines?.length) {
      await this.applyStock(tx, businessId, txn.branchId, txnType, txn.txnNumber, txn.lines, invert);
    }

    // 2. Party balance + ledger
    if (txnType === 'P2P_TRANSFER') {
      if (txn.partyId && txn.p2pToPartyId) {
        const amt = invert ? txn.total.neg() : txn.total;
        const from = await tx.party.update({ where: { id: txn.partyId }, data: { currentBalance: { increment: amt.neg() } } });
        const to = await tx.party.update({ where: { id: txn.p2pToPartyId }, data: { currentBalance: { increment: amt } } });
        await tx.partyLedgerEntry.createMany({
          data: [
            { businessId, partyId: txn.partyId, txnId: txn.id, entryType: 'P2P', amount: amt.neg(), balance: from.currentBalance, description: `P2P transfer ${txn.txnNumber}`, entryDate: txn.date },
            { businessId, partyId: txn.p2pToPartyId, txnId: txn.id, entryType: 'P2P', amount: amt, balance: to.currentBalance, description: `P2P transfer ${txn.txnNumber}`, entryDate: txn.date },
          ],
        });
      }
    } else if (txn.partyId) {
      // Use the balance as it stood right after this txn's own payments (not the live
      // `balance` column, which later bill-wise allocations from other txns mutate), so
      // reversal/restore always matches what was actually posted at creation time.
      const originalPaid = payments.filter((p) => p.paymentType !== 'DEBT').reduce((s, p) => s.add(D(p.amount)), D(0));
      const delta = this.partyDelta(txnType, txn.total, txn.total.sub(originalPaid));
      await this.applyPartyBalance(
        tx, businessId, txn.branchId, txn.id, txnType, txn.partyId, delta,
        `${txnType.replace(/_/g, ' ')} ${txn.txnNumber}`, txn.date, invert,
      );
    }

    // 3. Money accounts (cheques included)
    const inbound = ['SALE_INVOICE', 'SALE_ORDER', 'PAYMENT_IN', 'DEBIT_NOTE'].includes(txnType);
    if (payments.length) {
      await this.applyPayments(tx, businessId, txn.branchId, txn.id, txnType, txn.partyName, payments, inbound, invert);
    }

    // 4. Bill-wise allocations for payments
    if ((txnType === 'PAYMENT_IN' || txnType === 'PAYMENT_OUT') && (input.allocations as AllocationInput[] | undefined)?.length) {
      await this.applyAllocations(tx, businessId, txn.id, input.allocations as AllocationInput[], invert);
    }
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  async listTxns(businessId: string, q: {
    txnType?: string; partyId?: string; status?: string; branchId?: string;
    from?: string; to?: string; search?: string; page?: number; limit?: number;
    includeDeleted?: boolean;
  }) {
    const where: Prisma.TxnWhereInput = {
      businessId,
      ...(q.includeDeleted ? { deletedAt: { not: null } } : { deletedAt: null }),
      ...(q.txnType && { txnType: { in: q.txnType.split(',') } }),
      ...(q.partyId && { partyId: q.partyId }),
      ...(q.status && { status: { in: q.status.split(',') } }),
      ...(q.branchId && { branchId: q.branchId }),
      ...((q.from || q.to) && {
        date: {
          ...(q.from && { gte: new Date(q.from) }),
          ...(q.to && { lte: endOfDay(q.to) }),
        },
      }),
      ...(q.search && {
        OR: [
          { txnNumber: { contains: q.search, mode: 'insensitive' } },
          { partyName: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(200, Number(q.limit) || 50);
    const [data, totalCount, sums] = await Promise.all([
      this.prisma.txn.findMany({
        where,
        include: { party: { select: { id: true, name: true, phone: true } }, payments: true, lines: true },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.txn.count({ where }),
      this.prisma.txn.aggregate({ where, _sum: { total: true, balance: true, paidAmount: true } }),
    ]);
    return {
      data,
      meta: { page, limit, total: totalCount },
      summary: {
        totalAmount: Number(sums._sum.total ?? 0),
        totalBalance: Number(sums._sum.balance ?? 0),
        totalPaid: Number(sums._sum.paidAmount ?? 0),
      },
    };
  }

  async getTxn(businessId: string, id: string) {
    const txn = await this.prisma.txn.findFirst({
      where: { id, businessId },
      include: {
        lines: { include: { item: { select: { id: true, name: true, sku: true, baseUnit: true } } } },
        payments: { include: { bankAccount: true, cheque: true } },
        party: true,
        sourceTxn: { select: { id: true, txnType: true, txnNumber: true } },
        convertedTxns: { select: { id: true, txnType: true, txnNumber: true } },
        returnAgainst: { select: { id: true, txnType: true, txnNumber: true } },
        returns: { select: { id: true, txnType: true, txnNumber: true } },
        allocationsAsPayment: { include: { againstTxn: { select: { id: true, txnType: true, txnNumber: true, total: true } } } },
        allocationsAsInvoice: { include: { paymentTxn: { select: { id: true, txnType: true, txnNumber: true } } } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        expenseCategory: true,
      },
    });
    if (!txn) throw new NotFoundException('Transaction not found');
    return txn;
  }

  // ─── Delete / restore (recycle bin) ───────────────────────────────────────

  async deleteTxn(businessId: string, id: string) {
    const txn = await this.getTxn(businessId, id);
    if (txn.deletedAt) throw new BadRequestException('Already deleted');
    if (txn.convertedTxns.length) throw new BadRequestException('Cannot delete: converted transactions exist');

    return this.prisma.$transaction(async (tx) => {
      if (txn.status !== 'HELD') {
        const payments: TxnPaymentInput[] = txn.payments.map((p) => ({
          paymentType: p.paymentType,
          bankAccountId: p.bankAccountId ?? undefined,
          amount: Number(p.amount),
          referenceNo: p.referenceNo ?? undefined,
        }));
        const allocations = txn.allocationsAsPayment.map((a) => ({
          againstTxnId: a.againstTxnId,
          amount: Number(a.amount),
          discountAmount: Number(a.discountAmount),
        }));
        await this.postEffects(tx, businessId, txn, { allocations }, payments, true);
      }
      // Restore source order/estimate status if this was a conversion
      if (txn.sourceTxnId) {
        await tx.txn.update({ where: { id: txn.sourceTxnId }, data: { status: 'ORDER_OPEN' } }).catch(() => {});
      }
      return tx.txn.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  async restoreTxn(businessId: string, id: string) {
    const txn = await this.prisma.txn.findFirst({
      where: { id, businessId, deletedAt: { not: null } },
      include: { lines: true, payments: true, allocationsAsPayment: true },
    });
    if (!txn) throw new NotFoundException('Deleted transaction not found');

    return this.prisma.$transaction(async (tx) => {
      if (txn.status !== 'HELD') {
        const payments: TxnPaymentInput[] = txn.payments.map((p) => ({
          id: p.id,
          paymentType: p.paymentType,
          bankAccountId: p.bankAccountId ?? undefined,
          amount: Number(p.amount),
          referenceNo: p.referenceNo ?? undefined,
        }));
        // Note: cheque rows were removed on delete; allocation rows survive, so re-apply
        // their effect on the against-txn without re-creating the rows.
        const allocations: AllocationInput[] = txn.allocationsAsPayment.map((a) => ({
          id: a.id,
          againstTxnId: a.againstTxnId,
          amount: Number(a.amount),
          discountAmount: Number(a.discountAmount),
        }));
        await this.postEffects(tx, businessId, txn, { allocations }, payments, false);
      }
      return tx.txn.update({ where: { id }, data: { deletedAt: null } });
    });
  }

  // ─── Conversion ────────────────────────────────────────────────────────────

  async convertTxn(
    businessId: string,
    userId: string,
    sourceId: string,
    targetType: TxnType,
    overrides?: Partial<CreateTxnInput>,
  ) {
    const source = await this.getTxn(businessId, sourceId);
    if (source.status === 'CONVERTED' || source.status === 'ORDER_CLOSED') {
      throw new BadRequestException('Already converted');
    }
    // Atomically claim the conversion (compare-and-swap on status) before creating the
    // target txn, so two concurrent conversions of the same source can't both proceed.
    const newStatus = source.txnType === 'ESTIMATE' || source.txnType === 'DELIVERY_CHALLAN' ? 'CONVERTED' : 'ORDER_CLOSED';
    const claim = await this.prisma.txn.updateMany({
      where: { id: source.id, businessId, status: source.status },
      data: { status: newStatus },
    });
    if (claim.count === 0) {
      throw new BadRequestException('Already converted');
    }
    try {
      return await this.createTxn(businessId, userId, {
        txnType: targetType,
        branchId: source.branchId ?? undefined,
        partyId: source.partyId ?? undefined,
        partyName: source.partyName ?? undefined,
        lines: source.lines.map((l) => ({
          itemId: l.itemId ?? undefined,
          name: l.name,
          hsnCode: l.hsnCode ?? undefined,
          quantity: Number(l.quantity),
          unit: l.unit,
          unitPrice: Number(l.unitPrice),
          discountPercent: l.discountPercent != null ? Number(l.discountPercent) : undefined,
          discountAmount: Number(l.discountAmount),
          taxRate: Number(l.taxRate),
        })),
        discountPercent: source.discountPercent != null ? Number(source.discountPercent) : undefined,
        additionalCharges: (source.additionalCharges as { name: string; amount: number }[] | null) ?? undefined,
        description: source.description ?? undefined,
        sourceTxnId: source.id,
        ...overrides,
      });
    } catch (err) {
      // Creation failed - release the claim so the source can still be converted.
      await this.prisma.txn.update({ where: { id: source.id }, data: { status: source.status } }).catch(() => {});
      throw err;
    }
  }
}

export function endOfDay(d: string | Date) {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
}
