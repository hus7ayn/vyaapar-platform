import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  findAll(businessId: string, status?: string, branchId?: string) {
    return this.prisma.serviceRequest.findMany({
      where: {
        businessId,
        ...(status && { status }),
        ...(branchId && { room: { branchId } }),
      },
      include: { room: true, assignee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(businessId: string, data: Record<string, any>) {
    let reservationId: string | null = null;
    if (data.roomId) {
      const activeRes = await this.prisma.reservation.findFirst({
        where: { roomId: data.roomId, status: 'CHECKED_IN' },
      });
      if (activeRes) {
        reservationId = activeRes.id;
      }
    }

    return this.prisma.serviceRequest.create({
      data: {
        businessId,
        serviceType: data.serviceType,
        description: data.description,
        roomId: data.roomId || null,
        amount: data.amount ? Number(data.amount) : null,
        reservationId,
      },
      include: { room: true },
    });
  }

  async updateStatus(businessId: string, id: string, status: string, assignedTo?: string) {
    const existing = await this.prisma.serviceRequest.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Service request not found');
    return this.prisma.serviceRequest.update({
      where: { id },
      data: { status, assignedTo, completedAt: status === 'COMPLETED' ? new Date() : null },
    });
  }

  async remove(businessId: string, id: string) {
    const existing = await this.prisma.serviceRequest.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Service request not found');
    return this.prisma.serviceRequest.delete({ where: { id } });
  }
}
