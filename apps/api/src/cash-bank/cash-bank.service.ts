import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';

const D = (v: number | string | Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);

@Injectable()
export class CashBankService {
  constructor(private prisma: PrismaService) {}

  listAccounts(businessId: string, branchId?: string) {
    return this.prisma.bankAccount.findMany({
      where: { businessId, isActive: true, ...branchWhere(branchId) },
      orderBy: [{ accountType: 'asc' }, { name: 'asc' }],
    });
  }

  async summary(businessId: string, branchId?: string) {
    const accounts = await this.listAccounts(businessId, branchId);
    const cashBalance = accounts.filter((a) => a.accountType === 'CASH').reduce((s, a) => s + Number(a.balance), 0);
    const bankBalance = accounts.filter((a) => a.accountType === 'BANK').reduce((s, a) => s + Number(a.balance), 0);

    const parties = await this.prisma.party.findMany({
      where: { businessId, deletedAt: null, ...branchWhere(branchId) },
    });
    let totalReceivable = 0;
    let totalPayable = 0;
    for (const p of parties) {
      const bal = Number(p.currentBalance);
      if (bal > 0) totalReceivable += bal;
      else totalPayable += -bal;
    }

    const bw = branchWhere(branchId);
    const [openChequesReceived, openChequesPaid, loans] = await Promise.all([
      this.prisma.cheque.aggregate({ where: { businessId, status: 'OPEN', direction: 'RECEIVED', ...bw }, _sum: { amount: true } }),
      this.prisma.cheque.aggregate({ where: { businessId, status: 'OPEN', direction: 'PAID', ...bw }, _sum: { amount: true } }),
      this.prisma.loanAccount.aggregate({ where: { businessId, isActive: true, ...bw }, _sum: { currentBalance: true } }),
    ]);

    return {
      cashBalance,
      bankBalance,
      totalBalance: cashBalance + bankBalance,
      accounts,
      totalReceivable,
      totalPayable,
      openChequesReceived: Number(openChequesReceived._sum.amount ?? 0),
      openChequesPaid: Number(openChequesPaid._sum.amount ?? 0),
      loanBalance: Number(loans._sum.currentBalance ?? 0),
    };
  }

  createAccount(businessId: string, branchId: string | undefined, body: {
    name: string; accountType?: string; accountNumber?: string; bankName?: string;
    ifscCode?: string; upiId?: string; openingBalance?: number; asOfDate?: string; printOnInvoice?: boolean;
  }) {
    if (!body.name?.trim()) throw new BadRequestException('Account name is required');
    return this.prisma.bankAccount.create({
      data: {
        businessId,
        branchId: branchId ?? null,
        name: body.name.trim(),
        accountType: body.accountType ?? 'BANK',
        accountNumber: body.accountNumber,
        bankName: body.bankName,
        ifscCode: body.ifscCode,
        upiId: body.upiId,
        openingBalance: body.openingBalance ?? 0,
        asOfDate: body.asOfDate ? new Date(body.asOfDate) : new Date(),
        balance: body.openingBalance ?? 0,
        printOnInvoice: body.printOnInvoice ?? false,
      },
    });
  }

  async updateAccount(businessId: string, id: string, body: Record<string, unknown>) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, businessId } });
    if (!account) throw new NotFoundException('Account not found');
    return this.prisma.bankAccount.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name as string }),
        ...(body.accountNumber !== undefined && { accountNumber: body.accountNumber as string }),
        ...(body.bankName !== undefined && { bankName: body.bankName as string }),
        ...(body.ifscCode !== undefined && { ifscCode: body.ifscCode as string }),
        ...(body.upiId !== undefined && { upiId: body.upiId as string }),
        ...(body.printOnInvoice !== undefined && { printOnInvoice: body.printOnInvoice as boolean }),
        ...(body.isActive !== undefined && { isActive: body.isActive as boolean }),
      },
    });
  }

  async accountStatement(businessId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, businessId } });
    if (!account) throw new NotFoundException('Account not found');

    const [payments, transfersFrom, transfersTo, chequeDeposits] = await Promise.all([
      this.prisma.txnPayment.findMany({
        where: { bankAccountId: id, txn: { businessId, deletedAt: null } },
        include: { txn: { select: { id: true, txnType: true, txnNumber: true, partyName: true, date: true } } },
      }),
      this.prisma.bankTransfer.findMany({ where: { businessId, fromAccountId: id } }),
      this.prisma.bankTransfer.findMany({ where: { businessId, toAccountId: id } }),
      this.prisma.cheque.findMany({ where: { businessId, depositAccountId: id, status: 'CLOSED' } }),
    ]);

    const inboundTypes = ['SALE_INVOICE', 'PAYMENT_IN', 'DEBIT_NOTE', 'SALE_ORDER'];
    const entries = [
      ...payments.map((p) => ({
        date: p.txn.date,
        type: p.txn.txnType,
        ref: p.txn.txnNumber,
        party: p.txn.partyName,
        amount: inboundTypes.includes(p.txn.txnType) ? Number(p.amount) : -Number(p.amount),
      })),
      ...transfersFrom.map((t) => ({ date: t.date, type: 'TRANSFER_OUT', ref: t.transferType, party: t.description, amount: -Number(t.amount) })),
      ...transfersTo.map((t) => ({ date: t.date, type: 'TRANSFER_IN', ref: t.transferType, party: t.description, amount: Number(t.amount) })),
      ...chequeDeposits.map((c) => ({ date: c.transferDate ?? c.issueDate, type: 'CHEQUE_DEPOSIT', ref: c.chequeNumber ?? 'Cheque', party: c.partyName, amount: c.direction === 'RECEIVED' ? Number(c.amount) : -Number(c.amount) })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { account, entries };
  }

  async createTransfer(businessId: string, branchId: string | undefined, body: {
    transferType: string; fromAccountId?: string; toAccountId?: string;
    amount: number; date?: string; description?: string;
  }) {
    const amount = D(body.amount);
    if (amount.lte(0)) throw new BadRequestException('Amount must be positive');
    const { transferType } = body;

    return this.prisma.$transaction(async (tx) => {
      const needsFrom = ['BANK_TO_BANK', 'BANK_TO_CASH', 'CASH_TO_BANK', 'ADJUST_DECREASE'].includes(transferType);
      const needsTo = ['BANK_TO_BANK', 'BANK_TO_CASH', 'CASH_TO_BANK', 'ADJUST_INCREASE'].includes(transferType);

      if (needsFrom) {
        if (!body.fromAccountId) throw new BadRequestException('Source account required');
        await tx.bankAccount.update({ where: { id: body.fromAccountId }, data: { balance: { decrement: amount } } });
      }
      if (needsTo) {
        if (!body.toAccountId) throw new BadRequestException('Destination account required');
        await tx.bankAccount.update({ where: { id: body.toAccountId }, data: { balance: { increment: amount } } });
      }

      return tx.bankTransfer.create({
        data: {
          businessId,
          branchId: branchId ?? null,
          transferType,
          fromAccountId: body.fromAccountId,
          toAccountId: body.toAccountId,
          amount,
          date: body.date ? new Date(body.date) : new Date(),
          description: body.description,
        },
      });
    });
  }

  listTransfers(businessId: string, branchId?: string) {
    return this.prisma.bankTransfer.findMany({
      where: { businessId, ...branchWhere(branchId) },
      include: { from: true, to: true },
      orderBy: { date: 'desc' },
    });
  }

  listCheques(businessId: string, branchId?: string, status?: string) {
    return this.prisma.cheque.findMany({
      where: { businessId, ...branchWhere(branchId), ...(status && { status }) },
      include: { depositAccount: true, txnPayment: { include: { txn: { select: { id: true, txnType: true, txnNumber: true } } } } },
      orderBy: { issueDate: 'desc' },
    });
  }

  async settleCheque(businessId: string, id: string, body: { accountId: string; transferDate?: string }) {
    const cheque = await this.prisma.cheque.findFirst({ where: { id, businessId } });
    if (!cheque) throw new NotFoundException('Cheque not found');
    if (cheque.status === 'CLOSED') throw new BadRequestException('Cheque already settled');

    return this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: body.accountId },
        data: { balance: { increment: cheque.direction === 'RECEIVED' ? cheque.amount : cheque.amount.neg() } },
      });
      return tx.cheque.update({
        where: { id },
        data: {
          status: 'CLOSED',
          depositAccountId: body.accountId,
          transferDate: body.transferDate ? new Date(body.transferDate) : new Date(),
        },
      });
    });
  }

  async reopenCheque(businessId: string, id: string) {
    const cheque = await this.prisma.cheque.findFirst({ where: { id, businessId } });
    if (!cheque) throw new NotFoundException('Cheque not found');
    if (cheque.status !== 'CLOSED' || !cheque.depositAccountId) throw new BadRequestException('Cheque is not settled');

    return this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.update({
        where: { id: cheque.depositAccountId! },
        data: { balance: { increment: cheque.direction === 'RECEIVED' ? cheque.amount.neg() : cheque.amount } },
      });
      return tx.cheque.update({ where: { id }, data: { status: 'OPEN', depositAccountId: null, transferDate: null } });
    });
  }

  listLoans(businessId: string, branchId?: string) {
    return this.prisma.loanAccount.findMany({
      where: { businessId, isActive: true, ...branchWhere(branchId) },
      include: { loanTxns: { orderBy: { date: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createLoan(businessId: string, branchId: string | undefined, body: {
    name: string; lenderBank?: string; accountNumber?: string; description?: string;
    openingBalance: number; openingDate?: string; interestRate?: number; termMonths?: number;
    processingFee?: number; depositAccountId?: string;
  }) {
    if (!body.name?.trim()) throw new BadRequestException('Loan account name required');
    const opening = D(body.openingBalance);

    return this.prisma.$transaction(async (tx) => {
      const loan = await tx.loanAccount.create({
        data: {
          businessId,
          branchId: branchId ?? null,
          name: body.name.trim(),
          lenderBank: body.lenderBank,
          accountNumber: body.accountNumber,
          description: body.description,
          openingBalance: opening,
          currentBalance: opening,
          openingDate: body.openingDate ? new Date(body.openingDate) : new Date(),
          interestRate: body.interestRate,
          termMonths: body.termMonths,
          processingFee: body.processingFee,
        },
      });

      if (body.depositAccountId && opening.gt(0)) {
        await tx.bankAccount.update({
          where: { id: body.depositAccountId },
          data: { balance: { increment: opening } },
        });
        await tx.loanTxn.create({
          data: {
            loanAccountId: loan.id,
            txnType: 'DISBURSEMENT',
            principalAmount: opening,
            interestAmount: 0,
            totalAmount: opening,
            date: loan.openingDate,
            description: 'Opening disbursement',
            paidFromAccountId: body.depositAccountId,
          },
        });
      }

      return loan;
    });
  }

  async createLoanTxn(businessId: string, loanId: string, body: {
    txnType: string; amount: number; date?: string; description?: string; paidFromAccountId?: string;
  }) {
    const loan = await this.prisma.loanAccount.findFirst({ where: { id: loanId, businessId } });
    if (!loan) throw new NotFoundException('Loan not found');
    const amount = D(body.amount);
    if (amount.lte(0)) throw new BadRequestException('Amount must be positive');

    const isDisbursement = body.txnType === 'DISBURSEMENT';
    const delta = isDisbursement ? amount : amount.neg();

    return this.prisma.$transaction(async (tx) => {
      if (body.paidFromAccountId) {
        await tx.bankAccount.update({
          where: { id: body.paidFromAccountId },
          data: { balance: { increment: isDisbursement ? amount : amount.neg() } },
        });
      }
      await tx.loanAccount.update({ where: { id: loanId }, data: { currentBalance: { increment: delta } } });
      return tx.loanTxn.create({
        data: {
          loanAccountId: loanId,
          txnType: body.txnType,
          principalAmount: isDisbursement ? amount : amount,
          interestAmount: 0,
          totalAmount: amount,
          date: body.date ? new Date(body.date) : new Date(),
          description: body.description,
          paidFromAccountId: body.paidFromAccountId,
        },
      });
    });
  }
}
