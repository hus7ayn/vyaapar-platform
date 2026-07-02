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

  async create(businessId: string, body: PartyInput, branchId?: string) {
    if (!body.name?.trim()) throw new BadRequestException('Party name is required');
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
