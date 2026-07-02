import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UtilitiesService } from './utilities.service';

@ApiTags('utilities')
@ApiBearerAuth()
@Controller('utilities')
@UseGuards(PermissionsGuard)
export class UtilitiesController {
  constructor(private utilities: UtilitiesService) {}

  @Post('verify-data')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  verifyData(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query('fix') fix?: string,
  ) {
    return this.utilities.verifyData(businessId, fix === 'true', branchId);
  }
}
