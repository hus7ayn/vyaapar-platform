import { Module } from '@nestjs/common';
import { CashBankController } from './cash-bank.controller';
import { CashBankService } from './cash-bank.service';

@Module({
  controllers: [CashBankController],
  providers: [CashBankService],
  exports: [CashBankService],
})
export class CashBankModule {}
