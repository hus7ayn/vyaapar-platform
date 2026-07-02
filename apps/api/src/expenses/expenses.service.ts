import { BadRequestException, Injectable } from '@nestjs/common';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTxnInput, TxnCoreService } from '../txns/txn-core.service';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService, private core: TxnCoreService) {}

  // ─── Categories ────────────────────────────────────────────────────────────

  listCategories(businessId: string, branchId?: string) {
    return this.prisma.expenseCategory.findMany({
      where: { businessId, ...branchWhere(branchId) },
      include: { _count: { select: { txns: true } } },
      orderBy: { name: 'asc' },
    });
  }

  createCategory(businessId: string, branchId: string | undefined, body: { name: string; isGst?: boolean }) {
    if (!body.name?.trim()) throw new BadRequestException('Category name required');
    return this.prisma.expenseCategory.create({
      data: { businessId, branchId: branchId ?? null, name: body.name.trim(), isGst: body.isGst ?? false },
    });
  }

  // ─── Expenses (Txn-backed) ─────────────────────────────────────────────────

  list(businessId: string, q: Record<string, string>) {
    return this.core.listTxns(businessId, { ...q, txnType: 'EXPENSE' });
  }

  async create(businessId: string, userId: string, body: Omit<CreateTxnInput, 'txnType'> & { amount?: number }) {
    if (!body.expenseCategoryId) throw new BadRequestException('Expense category is required');
    const total = body.lines?.length ? undefined : (body.amount ?? body.total);
    if (!body.lines?.length && (!total || total <= 0)) throw new BadRequestException('Expense amount required');

    return this.core.createTxn(businessId, userId, {
      ...body,
      txnType: 'EXPENSE',
      total,
      payments: body.payments?.length
        ? body.payments
        : [{ paymentType: 'CASH', amount: total ?? 0 }],
    });
  }

  async byCategory(businessId: string, branchId?: string, from?: string, to?: string) {
    const txns = await this.prisma.txn.findMany({
      where: {
        businessId,
        txnType: 'EXPENSE',
        deletedAt: null,
        ...branchWhere(branchId),
        ...((from || to) && {
          date: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
          },
        }),
      },
      include: { expenseCategory: true },
    });
    const byCat: Record<string, { category: string; count: number; total: number }> = {};
    for (const t of txns) {
      const name = t.expenseCategory?.name ?? 'Uncategorized';
      if (!byCat[name]) byCat[name] = { category: name, count: 0, total: 0 };
      byCat[name].count++;
      byCat[name].total += Number(t.total);
    }
    return {
      categories: Object.values(byCat).sort((a, b) => b.total - a.total),
      grandTotal: txns.reduce((s, t) => s + Number(t.total), 0),
    };
  }
}
