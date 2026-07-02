import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { TxnCoreService } from './txn-core.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('txns')
@UseGuards(PermissionsGuard)
export class TxnsController {
  constructor(private core: TxnCoreService) {}

  @Get()
  @RequirePermissions(Permission.REPORTS_VIEW)
  list(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.core.listTxns(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Get('recycle-bin')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  recycleBin(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.core.listTxns(businessId, { ...q, branchId: branchId ?? q.branchId, includeDeleted: true });
  }

  @Get(':id')
  @RequirePermissions(Permission.REPORTS_VIEW)
  get(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.core.getTxn(businessId, id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.POS_SELL)
  remove(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.core.deleteTxn(businessId, id);
  }

  @Post(':id/restore')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  restore(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.core.restoreTxn(businessId, id);
  }
}
