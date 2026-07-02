import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(PermissionsGuard)
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get('firm')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  getFirm(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.settings.getFirmSettings(businessId, branchId);
  }

  @Patch('firm')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  updateFirm(@CurrentUser('businessId') businessId: string, @Body() body: Parameters<SettingsService['updateFirmSettings']>[1]) {
    return this.settings.updateFirmSettings(businessId, body);
  }

  @Post('numbering')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  updateNumbering(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: { txnType: string; prefix: string; nextNumber?: number },
  ) {
    return this.settings.updateTxnNumbering(businessId, branchId, body);
  }
}
