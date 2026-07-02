import { Injectable } from '@nestjs/common';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService) {}

  list(businessId: string, branchId?: string) {
    return this.prisma.paymentReminder.findMany({
      where: { businessId, ...branchWhere(branchId) },
      include: { party: { select: { id: true, name: true, phone: true } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  async generate(businessId: string, branchId?: string) {
    const parties = await this.prisma.party.findMany({
      where: { businessId, deletedAt: null, currentBalance: { gt: 0 }, ...branchWhere(branchId) },
    });

    const reminders = [];
    for (const party of parties) {
      const existing = await this.prisma.paymentReminder.findFirst({
        where: { businessId, partyId: party.id, status: 'PENDING', ...branchWhere(branchId) },
      });
      if (existing) continue;

      reminders.push(await this.prisma.paymentReminder.create({
        data: {
          businessId,
          branchId: party.branchId,
          partyId: party.id,
          amount: party.currentBalance,
          dueDate: new Date(Date.now() + 7 * 86400000),
          channel: 'SMS',
          message: `Dear ${party.name}, you have an outstanding balance of Rs.${Number(party.currentBalance).toFixed(2)}. Kindly pay at the earliest.`,
        },
      }));
    }
    return reminders;
  }

  markSent(businessId: string, id: string) {
    return this.prisma.paymentReminder.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }
}
