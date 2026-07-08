import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  findForUser(businessId: string, userId: string) {
    return this.prisma.notification.findMany({
      where: {
        businessId,
        OR: [{ userId }, { userId: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(businessId: string, id: string) {
    const existing = await this.prisma.notification.findFirst({ where: { id, businessId } });
    if (!existing) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }
}
