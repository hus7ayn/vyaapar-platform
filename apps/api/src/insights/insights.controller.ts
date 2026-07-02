import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InsightsService } from './insights.service';
import { PushInsightsDto } from './dto/push-insights.dto';

@Controller('insights')
export class InsightsController {
  constructor(private insights: InsightsService) {}

  /** Local API: compute daily summaries from transactions on this machine. */
  @Get('daily-local')
  dailyLocal(
    @CurrentUser() user: { businessId: string },
    @Query('branchId') branchId?: string,
  ) {
    return this.insights.dailyLocal(user.businessId, branchId);
  }

  /** Desktop app uploads daily summaries only — not full invoices. */
  @Post('push')
  push(@CurrentUser() user: { businessId: string }, @Body() body: PushInsightsDto) {
    return this.insights.pushInsights(
      user.businessId,
      body.branchId,
      body.deviceId,
      body.insights,
    );
  }

  /** Owner dashboard: aggregated revenue across desktop-connected shops. */
  @Get('summary')
  summary(
    @CurrentUser() user: { businessId: string },
    @Query('branchId') branchId?: string,
  ) {
    return this.insights.summary(user.businessId, branchId);
  }
}
