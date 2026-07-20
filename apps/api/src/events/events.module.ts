import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsGateway } from './events.gateway';

@Module({
  controllers: [EventsController],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
