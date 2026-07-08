import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ShiftsService } from './shifts.service';

@ApiTags('shifts')
@ApiBearerAuth()
@Controller('shifts')
@UseGuards(PermissionsGuard)
@RequirePermissions(Permission.POS_SELL)
export class ShiftsController {
  constructor(private shifts: ShiftsService) {}

  @Get('current')
  current(
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.shifts.getOpenShift(branchId, userId);
  }

  @Post('open')
  open(
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: { openingCash: number },
  ) {
    return this.shifts.openShift(branchId, userId, body.openingCash);
  }

  @Post(':id/close')
  close(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() body: { closingCash: number },
  ) {
    return this.shifts.closeShift(businessId, userId, id, body.closingCash);
  }
}
