import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { businessId, userId, channel, title, message, metadata } = job.data;

    await this.prisma.notification.create({
      data: { businessId, userId, title, message, type: channel, metadata },
    });

    switch (channel) {
      case 'email':
        console.log(`[Email] ${title}: ${message}`);
        break;
      case 'sms':
        console.log(`[SMS] ${title}: ${message}`);
        break;
      case 'whatsapp':
        console.log(`[WhatsApp] ${title}: ${message}`);
        break;
      case 'push':
        console.log(`[Push] ${title}: ${message}`);
        break;
    }
  }
}
