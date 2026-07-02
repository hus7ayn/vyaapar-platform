import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class QueuesService {
  constructor(
    @InjectQueue('notifications') private notifications: Queue,
    @InjectQueue('reports') private reports: Queue,
  ) {}

  enqueueNotification(data: {
    businessId: string;
    userId?: string;
    channel: 'email' | 'sms' | 'whatsapp' | 'push';
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.notifications.add('send', data, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  }

  enqueueReport(data: { businessId: string; type: string; email: string; params: Record<string, unknown> }) {
    return this.reports.add('generate', data);
  }
}
