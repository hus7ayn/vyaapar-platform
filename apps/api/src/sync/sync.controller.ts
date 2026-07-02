import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
@UseGuards(PermissionsGuard)
export class SyncController {
  constructor(private sync: SyncService) {}

  @Post('push')
  @RequirePermissions(Permission.POS_SELL)
  push(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('sub') cashierId: string,
    @Body() body: { clientId: string; operations: Array<{ entity: string; action: string; payload: Record<string, unknown> }> },
  ) {
    return this.sync.pushOperations(businessId, branchId, cashierId, body.clientId, body.operations);
  }

  @Get('pending')
  @RequirePermissions(Permission.POS_SELL)
  pending(
    @CurrentUser('businessId') businessId: string,
    @Query('clientId') clientId: string,
  ) {
    return this.sync.getPending(businessId, clientId);
  }
}
