import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationProcessor } from './processors/notification.processor';
import { QueuesService } from './queues.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    BullModule.registerQueue({ name: 'reports' }),
  ],
  providers: [NotificationProcessor, QueuesService],
  exports: [QueuesService, BullModule],
})
export class QueuesModule {}
