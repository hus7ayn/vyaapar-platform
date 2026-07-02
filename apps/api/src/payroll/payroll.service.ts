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

function calcNet(base: number, overtime: number, bonus: number, deductions: number) {
  return Math.max(0, base + overtime + bonus - deductions);
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

  async generatePayroll(businessId: string, period: string, branchId?: string) {
    if (!period?.match(/^\d{4}-\d{2}$/)) throw new BadRequestException('Period must be YYYY-MM');

    const resolvedBranch =
      branchId
      ?? (await this.prisma.branch.findFirst({ where: { businessId, isDefault: true, deletedAt: null } }))?.id;

    const existing = await this.prisma.payroll.findFirst({
      where: { businessId, period, branchId: resolvedBranch ?? null },
    });
    if (existing) throw new BadRequestException(`Payroll for ${period} already exists for this shop`);

    const employees = await this.prisma.employee.findMany({
      where: { businessId, isActive: true, ...this.branchWhere(resolvedBranch) },
    });
    if (!employees.length) throw new BadRequestException('No staff in this shop to pay');

    const lines = employees.map((e) => {
      const base = Number(e.baseSalary);
      return {
        employeeId: e.id,
        baseSalary: base,
        overtime: 0,
        bonus: 0,
        deductions: 0,
        netSalary: base,
      };
    });

    const totalAmount = lines.reduce((s, l) => s + l.netSalary, 0);

    return this.prisma.payroll.create({
      data: {
        businessId,
        branchId: resolvedBranch,
        period,
        status: 'DRAFT',
        totalAmount,
        lines: { create: lines },
      },
      include: { lines: { include: { employee: true } }, branch: true },
    });
  }

  async updateLine(
    businessId: string,
    payrollId: string,
    lineId: string,
    body: { overtime?: number; bonus?: number; deductions?: number },
  ) {
    const payroll = await this.prisma.payroll.findFirst({ where: { id: payrollId, businessId } });
    if (!payroll) throw new NotFoundException('Payroll not found');
    if (payroll.status === 'PAID') throw new BadRequestException('Cannot edit a paid payroll');

    const line = await this.prisma.payrollLine.findFirst({ where: { id: lineId, payrollId } });
    if (!line) throw new NotFoundException('Payroll line not found');

    const overtime = body.overtime ?? Number(line.overtime);
    const bonus = body.bonus ?? Number(line.bonus);
    const deductions = body.deductions ?? Number(line.deductions);
    const netSalary = calcNet(Number(line.baseSalary), overtime, bonus, deductions);

    return this.prisma.$transaction(async (tx) => {
      await tx.payrollLine.update({
        where: { id: lineId },
        data: { overtime, bonus, deductions, netSalary },
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

  private async salaryCategoryId(businessId: string, branchId?: string | null) {
    let cat = await this.prisma.expenseCategory.findFirst({
      where: { businessId, ...this.branchWhere(branchId ?? undefined), name: { equals: 'Salary', mode: 'insensitive' } },
    });
    if (!cat && branchId) {
      cat = await this.prisma.expenseCategory.create({
        data: { businessId, branchId, name: 'Salary', isGst: false },
      });
    }
    if (!cat) throw new BadRequestException('Salary expense category not found for this shop');
    return cat.id;
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
