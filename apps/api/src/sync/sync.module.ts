import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SaleModule } from '../sale/sale.module';

@Module({
  imports: [SaleModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
