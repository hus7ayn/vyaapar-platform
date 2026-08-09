import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';

/** Fallback when the user doesn't pick a day: chase the due a week from now. */
const DEFAULT_REMIND_IN_DAYS = 7;

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService) {}

  /** Validate a user-chosen reminder day. A reminder set in the past would never fire. */
  private resolveRemindOn(remindOn?: string): Date {
    if (!remindOn) return new Date(Date.now() + DEFAULT_REMIND_IN_DAYS * 86400000);
    const when = new Date(remindOn);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Pick a valid reminder date');
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (when < startOfToday) throw new BadRequestException('The reminder date cannot be in the past');
    return when;
  }

  list(businessId: string, branchId?: string) {
    return this.prisma.paymentReminder.findMany({
      where: { businessId, ...branchWhere(branchId) },
      include: { party: { select: { id: true, name: true, phone: true } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  async generate(businessId: string, branchId?: string, remindOn?: string) {
    const dueDate = this.resolveRemindOn(remindOn);
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
          dueDate,
          channel: 'SMS',
          message: `Dear ${party.name}, you have an outstanding balance of Rs.${Number(party.currentBalance).toFixed(2)}. Kindly pay at the earliest.`,
        },
      }));
    }
    return reminders;
  }

  /** Move a single reminder to a different day. */
  async reschedule(businessId: string, id: string, remindOn: string) {
    const existing = await this.prisma.paymentReminder.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Reminder not found');
    return this.prisma.paymentReminder.update({
      where: { id },
      data: { dueDate: this.resolveRemindOn(remindOn) },
    });
  }

  async markSent(businessId: string, id: string) {
    const existing = await this.prisma.paymentReminder.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Reminder not found');
    return this.prisma.paymentReminder.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }
}
