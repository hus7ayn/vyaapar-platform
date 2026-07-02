import { Global, Module } from '@nestjs/common';
import { TxnCoreService } from './txn-core.service';
import { TxnsController } from './txns.controller';

@Global()
@Module({
  controllers: [TxnsController],
  providers: [TxnCoreService],
  exports: [TxnCoreService],
})
export class TxnsModule {}
