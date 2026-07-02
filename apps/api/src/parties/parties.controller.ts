import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PartiesService, PartyInput } from './parties.service';

@ApiTags('parties')
@ApiBearerAuth()
@Controller('parties')
@UseGuards(PermissionsGuard)
export class PartiesController {
  constructor(private parties: PartiesService) {}

  @Get()
  @RequirePermissions(Permission.POS_SELL)
  list(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.parties.list(businessId, { search, type, groupId, branchId });
  }

  @Get('summary')
  @RequirePermissions(Permission.POS_SELL)
  summary(@CurrentUser('businessId') businessId: string, @CurrentUser('branchId') branchId?: string) {
    return this.parties.summary(businessId, branchId);
  }

  @Get('groups')
  @RequirePermissions(Permission.POS_SELL)
  listGroups(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.parties.listGroups(businessId, branchId);
  }

  @Post('groups')
  @RequirePermissions(Permission.POS_SELL)
  createGroup(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body('name') name: string,
  ) {
    return this.parties.createGroup(businessId, branchId, name);
  }

  @Post('import')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  import(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body('rows') rows: PartyInput[],
  ) {
    return this.parties.import(businessId, rows ?? [], branchId);
  }

  @Get(':id')
  @RequirePermissions(Permission.POS_SELL)
  get(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.parties.get(businessId, id);
  }

  @Get(':id/transactions')
  @RequirePermissions(Permission.POS_SELL)
  transactions(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.parties.transactions(businessId, id, branchId);
  }

  @Get(':id/ledger')
  @RequirePermissions(Permission.POS_SELL)
  ledger(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.parties.ledger(businessId, id, from, to, branchId);
  }

  @Post()
  @RequirePermissions(Permission.POS_SELL)
  create(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: PartyInput,
  ) {
    return this.parties.create(businessId, body, branchId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.POS_SELL)
  update(@CurrentUser('businessId') businessId: string, @Param('id') id: string, @Body() body: Partial<PartyInput>) {
    return this.parties.update(businessId, id, body);
  }

  @Delete(':id')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  remove(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.parties.remove(businessId, id);
  }
}
