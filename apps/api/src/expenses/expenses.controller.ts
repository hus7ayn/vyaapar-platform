import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CreateTxnInput } from '../txns/txn-core.service';
import { ExpensesService } from './expenses.service';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
@UseGuards(PermissionsGuard)
export class ExpensesController {
  constructor(private expenses: ExpensesService) {}

  @Get()
  @RequirePermissions(Permission.EXPENSE_VIEW)
  list(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query() q: Record<string, string>,
  ) {
    return this.expenses.list(businessId, { ...q, branchId: branchId ?? q.branchId });
  }

  @Post()
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  create(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: Omit<CreateTxnInput, 'txnType'> & { amount?: number },
  ) {
    return this.expenses.create(businessId, userId, body, branchId);
  }

  @Get('categories')
  @RequirePermissions(Permission.EXPENSE_VIEW)
  listCategories(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.expenses.listCategories(businessId, branchId);
  }

  @Post('categories')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  createCategory(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: { name: string; isGst?: boolean },
  ) {
    return this.expenses.createCategory(businessId, branchId, body);
  }

  @Get('by-category')
  @RequirePermissions(Permission.EXPENSE_VIEW)
  byCategory(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.expenses.byCategory(businessId, branchId, from, to);
  }
}
