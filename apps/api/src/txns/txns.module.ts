import { Global, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TxnCoreService } from './txn-core.service';
import { TxnsController } from './txns.controller';

@Global()
@Module({
  imports: [EventsModule],
  controllers: [TxnsController],
  providers: [TxnCoreService],
  exports: [TxnCoreService],
})
export class TxnsModule {}
