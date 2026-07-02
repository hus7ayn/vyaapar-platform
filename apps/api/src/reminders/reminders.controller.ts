import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RemindersService } from './reminders.service';

@ApiTags('payment-reminders')
@ApiBearerAuth()
@Controller('payment-reminders')
@UseGuards(PermissionsGuard)
export class RemindersController {
  constructor(private reminders: RemindersService) {}

  @Get()
  @RequirePermissions(Permission.REPORTS_VIEW)
  list(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.reminders.list(businessId, branchId);
  }

  @Post('generate')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  generate(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.reminders.generate(businessId, branchId);
  }

  @Post(':id/send')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  send(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.reminders.markSent(businessId, id);
  }
}
