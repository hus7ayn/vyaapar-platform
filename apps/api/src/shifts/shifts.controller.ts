import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ShiftsService } from './shifts.service';

@ApiTags('shifts')
@ApiBearerAuth()
@Controller('shifts')
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
  close(@Param('id') id: string, @Body() body: { closingCash: number }) {
    return this.shifts.closeShift(id, body.closingCash);
  }
}
