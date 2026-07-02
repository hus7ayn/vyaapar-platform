import { Module } from '@nestjs/common';
import { HotelController } from './hotel.controller';
import { HotelService } from './hotel.service';
import { OcrService } from '../ocr/ocr.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [HotelController],
  providers: [HotelService, OcrService],
})
export class HotelModule {}
