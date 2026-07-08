import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async openShift(branchId: string, userId: string, openingCash: number) {
    const existing = await this.prisma.shift.findFirst({
      where: { branchId, userId, status: 'OPEN' },
    });
    if (existing) throw new BadRequestException('Shift already open');
    return this.prisma.shift.create({
      data: { branchId, userId, openingCash, status: 'OPEN' },
    });
  }

  async closeShift(businessId: string, userId: string, shiftId: string, closingCash: number) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, userId, branch: { businessId } },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    return this.prisma.shift.update({
      where: { id: shiftId },
      data: { closingCash, closedAt: new Date(), status: 'CLOSED' },
    });
  }

  getOpenShift(branchId: string, userId: string) {
    return this.prisma.shift.findFirst({
      where: { branchId, userId, status: 'OPEN' },
    });
  }
}
