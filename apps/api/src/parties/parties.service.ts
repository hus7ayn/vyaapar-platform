import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PartyInput {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  gstType?: string;
  state?: string;
  billingAddress?: string;
  shippingAddress?: string;
  partyType?: string;
  groupId?: string;
  creditLimit?: number;
  openingBalance?: number;
  openingBalanceType?: string;
  openingDate?: string;
}

/**
 * Ad-hoc debt/credit recorded against an EXISTING party.
 * `direction` is written from the business's point of view:
 *   TO_PAY     → we owe them more  → currentBalance goes DOWN (payable)
 *   TO_RECEIVE → they owe us more  → currentBalance goes UP   (receivable)
 */
export interface PartyAdjustmentInput {
  amount: number;
  direction: 'TO_PAY' | 'TO_RECEIVE';
  note?: string;
  date?: string;
}

/** numeric(14,2) — anything at or above this cannot be stored. */
const MAX_AMOUNT = 1_000_000_000_000;

@Injectable()
export class PartiesService {
  constructor(private prisma: PrismaService) {}

  private branchWhere(branchId?: string) {
    return branchId ? { branchId } : {};
  }

  async list(businessId: string, q: { search?: string; type?: string; groupId?: string; branchId?: string }) {
    return this.prisma.party.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...this.branchWhere(q.branchId),
        ...(q.type && { partyType: { in: q.type === 'CUSTOMER' ? ['CUSTOMER', 'BOTH'] : q.type === 'SUPPLIER' ? ['SUPPLIER', 'BOTH'] : [q.type] } }),
        ...(q.groupId && { groupId: q.groupId }),
        ...(q.search && {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { phone: { contains: q.search } },
            { gstin: { contains: q.search, mode: 'insensitive' } },
          ],
        }),
      },
      include: { group: true },
      orderBy: { name: 'asc' },
    });
  }

  async summary(businessId: string, branchId?: string) {
    const parties = await this.prisma.party.findMany({
      where: { businessId, deletedAt: null, ...this.branchWhere(branchId) },
    });
    let totalReceivable = 0;
    let totalPayable = 0;
    for (const p of parties) {
      const bal = Number(p.currentBalance);
      if (bal > 0) totalReceivable += bal;
      else totalPayable += -bal;
    }
    return { totalReceivable, totalPayable, partyCount: parties.length };
  }

  async get(businessId: string, id: string) {
    const party = await this.prisma.party.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { group: true },
    });
    if (!party) throw new NotFoundException('Party not found');
    return party;
  }

  async transactions(businessId: string, id: string, branchId?: string) {
    return this.prisma.txn.findMany({
      where: { businessId, partyId: id, deletedAt: null, ...this.branchWhere(branchId) },
      orderBy: { date: 'desc' },
      include: { payments: true },
    });
  }

  async ledger(businessId: string, id: string, from?: string, to?: string, branchId?: string) {
    const party = await this.get(businessId, id);
    const entries = await this.prisma.partyLedgerEntry.findMany({
      where: {
        businessId,
        partyId: id,
        ...this.branchWhere(branchId),
        ...((from || to) && {
          entryDate: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
          },
        }),
      },
      orderBy: { entryDate: 'asc' },
      include: { txn: { select: { id: true, txnType: true, txnNumber: true, total: true } } },
    });
    return {
      party: { id: party.id, name: party.name, currentBalance: Number(party.currentBalance) },
      openingBalance: Number(party.openingBalance) * (party.openingBalanceType === 'TO_PAY' ? -1 : 1),
      entries,
    };
  }

  async create(businessId: string, body: PartyInput, branchId?: string, opts?: { requireComplete?: boolean }) {
    if (!body.name?.trim()) throw new BadRequestException('Party name is required');
    if (opts?.requireComplete) {
      // Interactive "Add Party" requires name + phone + explicit type; the bulk
      // import path calls create() without this flag so partial lists still load.
      if (!body.phone?.trim()) throw new BadRequestException('Phone number is required');
      if (!body.partyType || !['CUSTOMER', 'SUPPLIER', 'BOTH'].includes(body.partyType))
        throw new BadRequestException('A valid party type (Customer/Supplier/Both) is required');
    }
    const opening = new Prisma.Decimal(body.openingBalance ?? 0);
    const signedOpening = body.openingBalanceType === 'TO_PAY' ? opening.neg() : opening;
    const resolvedBranch =
      branchId
      ?? (await this.prisma.branch.findFirst({ where: { businessId, isDefault: true, deletedAt: null } }))?.id
      ?? (await this.prisma.branch.findFirst({ where: { businessId, type: 'SHOP', deletedAt: null } }))?.id;

    return this.prisma.$transaction(async (tx) => {
      const party = await tx.party.create({
        data: {
          businessId,
          branchId: resolvedBranch,
          name: body.name.trim(),
          phone: body.phone,
          email: body.email,
          gstin: body.gstin,
          gstType: body.gstType ?? 'UNREGISTERED',
          state: body.state,
          billingAddress: body.billingAddress,
          shippingAddress: body.shippingAddress,
          partyType: body.partyType ?? 'CUSTOMER',
          groupId: body.groupId,
          creditLimit: body.creditLimit,
          openingBalance: opening,
          openingBalanceType: body.openingBalanceType ?? 'TO_RECEIVE',
          openingDate: body.openingDate ? new Date(body.openingDate) : new Date(),
          currentBalance: signedOpening,
        },
      });
      if (!signedOpening.isZero()) {
        await tx.partyLedgerEntry.create({
          data: {
            businessId,
            branchId: resolvedBranch,
            partyId: party.id,
            entryType: 'OPENING',
            amount: signedOpening,
            balance: signedOpening,
            description: 'Opening balance',
            entryDate: party.openingDate ?? new Date(),
          },
        });
      }
      return party;
    });
  }

  async update(businessId: string, id: string, body: Partial<PartyInput>) {
    await this.get(businessId, id);
    return this.prisma.party.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.gstin !== undefined && { gstin: body.gstin }),
        ...(body.gstType !== undefined && { gstType: body.gstType }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.billingAddress !== undefined && { billingAddress: body.billingAddress }),
        ...(body.shippingAddress !== undefined && { shippingAddress: body.shippingAddress }),
        ...(body.partyType !== undefined && { partyType: body.partyType }),
        ...(body.groupId !== undefined && { groupId: body.groupId }),
        ...(body.creditLimit !== undefined && { creditLimit: body.creditLimit }),
      },
    });
  }

  /**
   * Hand-validate an adjustment body. The controller types it as an interface, so Nest's global
   * ValidationPipe has nothing to validate against — every field is whatever the client sent.
   */
  normaliseAdjustment(body: PartyAdjustmentInput | undefined) {
    const raw = body?.amount as unknown;
    const n =
      typeof raw === 'number' ? raw
      : typeof raw === 'string' && raw.trim() !== '' ? Number(raw)
      : NaN;
    if (!Number.isFinite(n)) throw new BadRequestException('A valid amount is required');
    const amount = Math.round(n * 100) / 100; // the column is numeric(14,2)
    if (amount <= 0) throw new BadRequestException('Amount must be greater than zero');
    if (amount >= MAX_AMOUNT) throw new BadRequestException('Amount is too large');

    const direction = body?.direction;
    if (direction !== 'TO_PAY' && direction !== 'TO_RECEIVE') {
      throw new BadRequestException('Direction must be TO_PAY or TO_RECEIVE');
    }

    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : '';
    let entryDate = new Date();
    if (body?.date !== undefined && body.date !== null && body.date !== '') {
      if (typeof body.date !== 'string') throw new BadRequestException('Invalid date');
      const parsed = new Date(body.date);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid date');
      entryDate = parsed;
    }

    // TO_PAY increases what we owe → the signed balance moves negative.
    const signed = new Prisma.Decimal(direction === 'TO_PAY' ? -amount : amount);
    return { amount, direction, signed, description: note || 'Manual adjustment', entryDate };
  }

  /**
   * Record extra debt (or credit) against an existing party without raising a Txn.
   *
   * Deliberately NOT a Txn: a bare "I owe this supplier another ₹8,000" has no items, no GST and
   * no stock, and every report keys off txnType — inventing a PURCHASE_BILL here would pollute
   * purchase totals, GST returns and COGS. The cost of that choice is that the adjustment shows in
   * the LEDGER tab and in Payables, but not in the Transactions tab (which lists Txns only).
   *
   * currentBalance and the ledger row are written together, exactly once each, in ONE transaction:
   * UtilitiesService.verifyData asserts currentBalance == Σ PartyLedgerEntry.amount and its "fix"
   * overwrites currentBalance with the ledger sum, so a path that moved only one of the two would
   * be silently undone by the owner's own Verify-my-data button.
   */
  async addAdjustment(businessId: string, id: string, body: PartyAdjustmentInput) {
    const { signed, description, entryDate } = this.normaliseAdjustment(body);
    const party = await this.get(businessId, id); // 404s + scopes to this business before we write

    return this.prisma.$transaction(async (tx) => {
      // Serialise per party (the same lock key sale.service.ts uses for its credit-limit check) so
      // two concurrent adjustments can't both read a stale balance and stamp the same `balance`
      // snapshot onto their ledger rows.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const updated = await tx.party.update({
        where: { id: party.id },
        data: { currentBalance: { increment: signed } },
      });
      const entry = await tx.partyLedgerEntry.create({
        data: {
          businessId,
          branchId: party.branchId,
          partyId: party.id,
          entryType: 'ADJUSTMENT',
          amount: signed,
          balance: updated.currentBalance,
          description,
          entryDate,
        },
      });
      return { party: updated, entry };
    });
  }

  async remove(businessId: string, id: string) {
    const party = await this.get(businessId, id);
    if (!new Prisma.Decimal(party.currentBalance).isZero()) {
      throw new BadRequestException('Cannot delete a party with outstanding balance');
    }
    return this.prisma.party.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ─── Groups ────────────────────────────────────────────────────────────────

  listGroups(businessId: string, branchId?: string) {
    return this.prisma.partyGroup.findMany({
      where: { businessId, ...this.branchWhere(branchId) },
      include: { _count: { select: { parties: true } } },
      orderBy: { name: 'asc' },
    });
  }

  createGroup(businessId: string, branchId: string | undefined, name: string) {
    if (!name?.trim()) throw new BadRequestException('Group name is required');
    return this.prisma.partyGroup.create({
      data: { businessId, branchId: branchId ?? null, name: name.trim() },
    });
  }

  // ─── Bulk import ───────────────────────────────────────────────────────────

  async import(businessId: string, rows: PartyInput[], branchId?: string) {
    const results = { created: 0, skipped: 0, errors: [] as string[] };
    for (const row of rows) {
      try {
        if (!row.name?.trim()) { results.skipped++; continue; }
        const exists = await this.prisma.party.findFirst({
          where: { businessId, name: row.name.trim(), deletedAt: null, ...this.branchWhere(branchId) },
        });
        if (exists) { results.skipped++; continue; }
        await this.create(businessId, row, branchId);
        results.created++;
      } catch (e) {
        results.errors.push(`${row.name}: ${(e as Error).message}`);
      }
    }
    return results;
  }
}
