import { Module } from '@nestjs/common';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, SuperAdminGuard],
})
export class PlatformModule {}
