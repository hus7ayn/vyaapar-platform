import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HousekeepingService {
  constructor(private prisma: PrismaService) {}

  findAll(businessId: string, status?: string, branchId?: string) {
    return this.prisma.housekeepingTask.findMany({
      where: {
        businessId,
        ...(status && { status }),
        ...(branchId && { room: { branchId } }),
      },
      include: { room: true, assignee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(businessId: string, data: { roomId: string; priority?: string; notes?: string }) {
    return this.prisma.housekeepingTask.create({
      data: {
        businessId,
        roomId: data.roomId,
        priority: data.priority ?? 'NORMAL',
        notes: data.notes,
        status: 'PENDING',
      },
      include: { room: true },
    });
  }

  async updateStatus(id: string, businessId: string, status: string, assignedTo?: string) {
    const task = await this.prisma.housekeepingTask.findFirst({
      where: { id, businessId },
      include: { room: true },
    });
    if (!task) return null;

    const updated = await this.prisma.housekeepingTask.update({
      where: { id },
      data: {
        status,
        assignedTo,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
      include: { room: true, assignee: { select: { firstName: true, lastName: true } } },
    });

    if (status === 'COMPLETED' && task.room.status === 'CLEANING') {
      await this.prisma.room.update({
        where: { id: task.roomId },
        data: { status: 'AVAILABLE' },
      });
    }

    return updated;
  }
}
