import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TxnCoreService } from '../txns/txn-core.service';

export interface EmployeeInput {
  employeeId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  baseSalary: number;
  joinDate?: string;
}

/**
 * Advance is salary already paid out, in cash or from the bank, earlier in the month, so it is
 * netted off what's still owed at payday. The advance EXPENSE and the payroll EXPENSE therefore
 * add up to exactly the salary earned — the money is booked once, never twice.
 */
export function calcNet(base: number, overtime: number, bonus: number, deductions: number, advance: number) {
  return Math.max(0, base + overtime + bonus - deductions - advance);
}

/**
 * The draft payroll line for one employee: recover as much of their outstanding advance as this
 * month's base pay can cover. Anything above base stays on the balance for the next run, so the
 * net salary can never go negative and no advance is ever recovered twice.
 */
export function buildDraftLine(
  employeeId: string,
  baseSalary: number | string,
  advanceBalance: number | string | null | undefined,
) {
  const base = Number(baseSalary);
  const advance = Math.max(0, Math.min(Number(advanceBalance ?? 0), base));
  return {
    employeeId,
    baseSalary: base,
    overtime: 0,
    bonus: 0,
    deductions: 0,
    advance,
    netSalary: calcNet(base, 0, 0, 0, advance),
  };
}

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private core: TxnCoreService,
  ) {}

  private branchWhere(branchId?: string) {
    return branchId ? { branchId } : {};
  }

  getEmployees(businessId: string, branchId?: string) {
    return this.prisma.employee.findMany({
      where: { businessId, isActive: true, ...this.branchWhere(branchId) },
      include: { branch: { select: { id: true, name: true, code: true } } },
      orderBy: { firstName: 'asc' },
    });
  }

  async createEmployee(businessId: string, branchId: string | undefined, body: EmployeeInput) {
    if (!body.firstName?.trim() || !body.lastName?.trim()) {
      throw new BadRequestException('First and last name are required');
    }
    if (!body.employeeId?.trim()) throw new BadRequestException('Employee ID is required');
    if (!body.baseSalary || body.baseSalary <= 0) throw new BadRequestException('Base salary must be positive');

    const resolvedBranch =
      branchId
      ?? (await this.prisma.branch.findFirst({ where: { businessId, isDefault: true, deletedAt: null } }))?.id
      ?? (await this.prisma.branch.findFirst({ where: { businessId, type: 'SHOP', deletedAt: null } }))?.id;

    return this.prisma.employee.create({
      data: {
        businessId,
        branchId: resolvedBranch,
        employeeId: body.employeeId.trim().toUpperCase(),
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        email: body.email,
        phone: body.phone,
        department: body.department,
        designation: body.designation,
        baseSalary: body.baseSalary,
        joinDate: body.joinDate ? new Date(body.joinDate) : new Date(),
      },
    });
  }

  async updateEmployee(businessId: string, id: string, body: Partial<EmployeeInput> & { isActive?: boolean }) {
    const emp = await this.prisma.employee.findFirst({ where: { id, businessId } });
    if (!emp) throw new NotFoundException('Employee not found');
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...(body.firstName !== undefined && { firstName: body.firstName }),
        ...(body.lastName !== undefined && { lastName: body.lastName }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.department !== undefined && { department: body.department }),
        ...(body.designation !== undefined && { designation: body.designation }),
        ...(body.baseSalary !== undefined && { baseSalary: body.baseSalary }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
  }

  getPayrolls(businessId: string, branchId?: string) {
    return this.prisma.payroll.findMany({
      where: { businessId, ...this.branchWhere(branchId) },
      include: {
        lines: { include: { employee: true } },
        branch: { select: { id: true, name: true, code: true } },
        expenseTxn: { select: { id: true, txnNumber: true, date: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  recordAttendance(employeeId: string, data: { date: string; checkIn?: string; checkOut?: string; status?: string }) {
    return this.prisma.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId,
          date: new Date(data.date),
        },
      },
      update: {
        checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
        checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
        status: data.status,
      },
      create: {
        employeeId,
        date: new Date(data.date),
        checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
        checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
        status: data.status || 'PRESENT',
      },
    });
  }

  getAttendance(employeeId: string) {
    return this.prisma.attendance.findMany({
      where: { employeeId },
      orderBy: { date: 'desc' },
      take: 30,
    });
  }

  async generatePayroll(
    businessId: string,
    startDate: string,
    endDate: string,
    branchId?: string,
    employeeIds?: string[],
  ) {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDate?.match(dateRe) || !endDate?.match(dateRe)) {
      throw new BadRequestException('Start and end dates are required (YYYY-MM-DD)');
    }
    if (startDate > endDate) throw new BadRequestException('Start date must be on or before end date');
    // The Payroll.period column is a free-form String; encode the range as
    // "start..end" so each distinct range is its own run under the
    // (businessId, branchId, period) unique key. No migration needed.
    const period = `${startDate}..${endDate}`;

    // Cover EVERY active staff member across the whole business, not just one
    // branch. Group by branch so each shop still gets its own payroll run
    // (matches the per-branch Payroll model + per-shop salary expense at payout).
    // Scope to a single shop when a branch is given, so one shop's payroll
    // doesn't sweep in another shop's staff (and vice-versa).
    // `employeeIds` narrows the run to the staff the owner actually picked.
    const picked = (employeeIds ?? []).filter((id) => !!id);
    const employees = await this.prisma.employee.findMany({
      where: {
        businessId,
        isActive: true,
        ...(branchId && { branchId }),
        ...(picked.length && { id: { in: picked } }),
      },
    });
    if (!employees.length) {
      throw new BadRequestException(
        picked.length ? 'The selected staff are not active in this entity' : 'No active staff to pay for this entity',
      );
    }

    const byBranch = new Map<string | null, typeof employees>();
    for (const e of employees) {
      const key = e.branchId ?? null;
      const arr = byBranch.get(key) ?? [];
      arr.push(e);
      byBranch.set(key, arr);
    }

    type Run = Prisma.PayrollGetPayload<{ include: { lines: { include: { employee: true } }; branch: true } }>;
    const created: Run[] = [];
    const updated: Run[] = [];
    let addedLines = 0;
    let paidSkips = 0;
    let alreadyOnRun = 0;

    for (const [bId, emps] of byBranch) {
      const existing = await this.prisma.payroll.findFirst({ where: { businessId, period, branchId: bId } });

      // A paid run is closed — its expense is already booked, so never touch it.
      if (existing?.status === 'PAID') { paidSkips++; continue; }

      if (existing) {
        // Top up the OPEN draft with the picked staff it doesn't cover yet. PayrollLine has no
        // unique key, so de-dupe here: an employee already on the run is left completely alone,
        // because their advance was drawn down when their line was first written.
        const existingLines = await this.prisma.payrollLine.findMany({
          where: { payrollId: existing.id },
          select: { employeeId: true },
        });
        const have = new Set(existingLines.map((l) => l.employeeId));
        const missing = emps.filter((e) => !have.has(e.id));
        if (!missing.length) { alreadyOnRun++; continue; }

        const payroll = await this.prisma.$transaction(async (tx) => {
          // Re-read inside the transaction: an advance recorded a moment ago must be recovered.
          const fresh = await tx.employee.findMany({
            where: { id: { in: missing.map((e) => e.id) } },
            select: { id: true, baseSalary: true, advanceBalance: true },
          });
          const lines = fresh.map((e) => buildDraftLine(e.id, Number(e.baseSalary), Number(e.advanceBalance ?? 0)));
          await tx.payrollLine.createMany({ data: lines.map((l) => ({ ...l, payrollId: existing.id })) });
          for (const l of lines) {
            if (l.advance > 0) {
              await tx.employee.update({ where: { id: l.employeeId }, data: { advanceBalance: { decrement: l.advance } } });
            }
          }
          const allLines = await tx.payrollLine.findMany({ where: { payrollId: existing.id } });
          return tx.payroll.update({
            where: { id: existing.id },
            data: { totalAmount: allLines.reduce((s, l) => s + Number(l.netSalary), 0) },
            include: { lines: { include: { employee: true } }, branch: true },
          });
        });
        addedLines += Math.max(0, payroll.lines.length - existingLines.length);
        updated.push(payroll);
        continue;
      }

      const payroll = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.employee.findMany({
          where: { id: { in: emps.map((e) => e.id) } },
          select: { id: true, baseSalary: true, advanceBalance: true },
        });
        // Auto-recover any outstanding salary advance in this run (capped at base pay).
        const lines = fresh.map((e) => buildDraftLine(e.id, Number(e.baseSalary), Number(e.advanceBalance ?? 0)));
        const p = await tx.payroll.create({
          data: {
            businessId,
            branchId: bId,
            period,
            status: 'DRAFT',
            totalAmount: lines.reduce((s, l) => s + l.netSalary, 0),
            lines: { create: lines },
          },
          include: { lines: { include: { employee: true } }, branch: true },
        });
        // Draw down each employee's advance balance by the amount recovered here.
        for (const l of lines) {
          if (l.advance > 0) {
            await tx.employee.update({ where: { id: l.employeeId }, data: { advanceBalance: { decrement: l.advance } } });
          }
        }
        return p;
      });
      addedLines += payroll.lines.length;
      created.push(payroll);
    }

    if (!created.length && !updated.length) {
      throw new BadRequestException(
        paidSkips
          ? `Payroll for ${period} has already been paid`
          : `The selected staff are already on the ${period} payroll run`,
      );
    }
    return {
      created: created.length,
      updated: updated.length,
      added: addedLines,
      skipped: paidSkips + alreadyOnRun,
      payrolls: [...created, ...updated],
    };
  }

  /**
   * Give an employee a salary advance. This is REAL money leaving the till or the bank, so it is
   * posted as an EXPENSE transaction exactly like a salary payout — visible in Cash & Bank, the
   * account statement, the day book, cash flow, P&L and expenses-by-category — and the balance is
   * recorded so the upcoming payroll run nets it off (advance expense + payroll expense = salary).
   */
  async recordAdvance(
    businessId: string,
    userId: string,
    employeeId: string,
    body: { amount: number; paymentType?: string; bankAccountId?: string; date?: string },
  ) {
    const amount = Math.round(Number(body?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Advance amount must be positive');
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, businessId } });
    if (!emp) throw new NotFoundException('Employee not found');

    // Book the expense against the employee's own shop, falling back to the default shop so an
    // unassigned employee's advance still lands in a real branch's books.
    const branchId =
      emp.branchId
      ?? (await this.prisma.branch.findFirst({ where: { businessId, isDefault: true, deletedAt: null }, select: { id: true } }))?.id
      ?? (await this.prisma.branch.findFirst({ where: { businessId, type: 'SHOP', deletedAt: null }, select: { id: true } }))?.id;

    const paymentType = body.paymentType ?? 'CASH';
    const categoryId = await this.expenseCategoryId(businessId, branchId, 'Staff Advance');
    const name = `${emp.firstName} ${emp.lastName}`.trim();

    // ONE transaction, ONE pooled connection: createTxn is handed this `tx` as its existingTx so
    // it never opens a nested $transaction (which previously 500'd in production).
    return this.prisma.$transaction(
      async (tx) => {
        await this.core.createTxn(
          businessId,
          userId,
          {
            txnType: 'EXPENSE',
            branchId: branchId ?? undefined,
            date: body.date ? new Date(body.date).toISOString() : new Date().toISOString(),
            expenseCategoryId: categoryId,
            partyName: name,
            description: `Salary advance — ${name}${emp.employeeId ? ` (${emp.employeeId})` : ''}`,
            total: amount,
            payments: [{ paymentType, bankAccountId: body.bankAccountId, amount }],
          },
          tx,
        );
        return tx.employee.update({
          where: { id: employeeId },
          data: { advanceBalance: { increment: amount } },
        });
      },
      { maxWait: 15000, timeout: 30000 },
    );
  }

  async updateLine(
    businessId: string,
    payrollId: string,
    lineId: string,
    body: { overtime?: number; bonus?: number; deductions?: number; advance?: number },
  ) {
    const payroll = await this.prisma.payroll.findFirst({ where: { id: payrollId, businessId } });
    if (!payroll) throw new NotFoundException('Payroll not found');
    if (payroll.status === 'PAID') throw new BadRequestException('Cannot edit a paid payroll');

    const line = await this.prisma.payrollLine.findFirst({ where: { id: lineId, payrollId } });
    if (!line) throw new NotFoundException('Payroll line not found');

    const overtime = body.overtime ?? Number(line.overtime);
    const bonus = body.bonus ?? Number(line.bonus);
    const deductions = body.deductions ?? Number(line.deductions);
    const advance = body.advance ?? Number(line.advance);
    if (!Number.isFinite(advance) || advance < 0) throw new BadRequestException('Advance cannot be negative');
    const netSalary = calcNet(Number(line.baseSalary), overtime, bonus, deductions, advance);

    // Editing the advance on a draft line MOVES money: the line's advance was already drawn down
    // from Employee.advanceBalance when the draft was generated, so recovering more (or less) here
    // has to move the balance by the same delta — otherwise the difference is either deducted from
    // the employee twice or silently written off.
    const delta = Math.round((advance - Number(line.advance)) * 100) / 100;

    return this.prisma.$transaction(async (tx) => {
      if (delta !== 0) {
        const emp = await tx.employee.findUnique({ where: { id: line.employeeId }, select: { advanceBalance: true } });
        const outstanding = Number(emp?.advanceBalance ?? 0);
        if (delta > outstanding + 0.005) {
          throw new BadRequestException(
            `Only ${outstanding.toFixed(2)} of advance is still outstanding for this employee (already recovered ${Number(line.advance).toFixed(2)} on this run)`,
          );
        }
        await tx.employee.update({ where: { id: line.employeeId }, data: { advanceBalance: { decrement: delta } } });
      }
      await tx.payrollLine.update({
        where: { id: lineId },
        data: { overtime, bonus, deductions, advance, netSalary },
      });
      const allLines = await tx.payrollLine.findMany({ where: { payrollId } });
      const totalAmount = allLines.reduce((s, l) => s + Number(l.netSalary), 0);
      return tx.payroll.update({
        where: { id: payrollId },
        data: { totalAmount },
        include: { lines: { include: { employee: true } }, branch: true },
      });
    });
  }

  /** Resolve — creating on first use — the named expense category for a shop. */
  private async expenseCategoryId(businessId: string, branchId: string | null | undefined, name: string) {
    let cat = await this.prisma.expenseCategory.findFirst({
      where: { businessId, ...this.branchWhere(branchId ?? undefined), name: { equals: name, mode: 'insensitive' } },
    });
    if (!cat && branchId) {
      cat = await this.prisma.expenseCategory.create({
        data: { businessId, branchId, name, isGst: false },
      });
    }
    if (!cat) throw new BadRequestException(`${name} expense category not found for this shop`);
    return cat.id;
  }

  private salaryCategoryId(businessId: string, branchId?: string | null) {
    return this.expenseCategoryId(businessId, branchId, 'Salary');
  }

  async payPayroll(
    businessId: string,
    userId: string,
    payrollId: string,
    body: { paymentType?: string; bankAccountId?: string },
  ) {
    const payroll = await this.prisma.payroll.findFirst({
      where: { id: payrollId, businessId },
      include: { lines: { include: { employee: true } }, branch: true },
    });
    if (!payroll) throw new NotFoundException('Payroll not found');
    if (payroll.status === 'PAID') throw new BadRequestException('Payroll already paid');
    if (Number(payroll.totalAmount) <= 0) throw new BadRequestException('Payroll total must be positive');

    const paymentType = body.paymentType ?? 'CASH';
    const salaryCategoryId = await this.salaryCategoryId(businessId, payroll.branchId);
    const shopLabel = payroll.branch?.name ?? 'Shop';
    const staffCount = payroll.lines.length;

    const txn = await this.core.createTxn(businessId, userId, {
      txnType: 'EXPENSE',
      branchId: payroll.branchId ?? undefined,
      date: new Date().toISOString(),
      expenseCategoryId: salaryCategoryId,
      description: `Staff salary ${payroll.period} — ${shopLabel} (${staffCount} staff)`,
      total: Number(payroll.totalAmount),
      payments: [{
        paymentType,
        bankAccountId: body.bankAccountId,
        amount: Number(payroll.totalAmount),
      }],
    });

    return this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'PAID',
        txnId: txn.id,
        paymentMode: paymentType,
        paidAt: new Date(),
        processedAt: new Date(),
      },
      include: {
        lines: { include: { employee: true } },
        branch: true,
        expenseTxn: { select: { id: true, txnNumber: true, date: true, total: true } },
      },
    });
  }

  async payrollSummary(businessId: string, branchId?: string, from?: string, to?: string) {
    const monthStart = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthEnd = to
      ? new Date(new Date(to).setHours(23, 59, 59, 999))
      : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);

    const paid = await this.prisma.payroll.aggregate({
      where: {
        businessId,
        status: 'PAID',
        paidAt: { gte: monthStart, lte: monthEnd },
        ...this.branchWhere(branchId),
      },
      _sum: { totalAmount: true },
      _count: true,
    });

    return {
      paidRuns: paid._count,
      totalPaid: Number(paid._sum.totalAmount ?? 0),
      periodFrom: monthStart.toISOString().slice(0, 10),
      periodTo: monthEnd.toISOString().slice(0, 10),
    };
  }
}
