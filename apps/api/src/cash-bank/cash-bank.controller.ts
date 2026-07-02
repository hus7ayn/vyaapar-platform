import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { CashBankService } from './cash-bank.service';

@ApiTags('cash-bank')
@ApiBearerAuth()
@Controller('cash-bank')
@UseGuards(PermissionsGuard)
export class CashBankController {
  constructor(private cashBank: CashBankService) {}

  @Get('accounts')
  @RequirePermissions(Permission.REPORTS_VIEW)
  listAccounts(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.cashBank.listAccounts(businessId, branchId);
  }

  @Get('summary')
  @RequirePermissions(Permission.REPORTS_VIEW)
  summary(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.cashBank.summary(businessId, branchId);
  }

  @Post('accounts')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  createAccount(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: Parameters<CashBankService['createAccount']>[2],
  ) {
    return this.cashBank.createAccount(businessId, branchId, body);
  }

  @Patch('accounts/:id')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  updateAccount(@CurrentUser('businessId') businessId: string, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.cashBank.updateAccount(businessId, id, body);
  }

  @Get('accounts/:id/statement')
  @RequirePermissions(Permission.REPORTS_VIEW)
  statement(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.cashBank.accountStatement(businessId, id);
  }

  @Get('transfers')
  @RequirePermissions(Permission.REPORTS_VIEW)
  listTransfers(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.cashBank.listTransfers(businessId, branchId);
  }

  @Post('transfers')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  createTransfer(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: Parameters<CashBankService['createTransfer']>[2],
  ) {
    return this.cashBank.createTransfer(businessId, branchId, body);
  }

  @Get('cheques')
  @RequirePermissions(Permission.REPORTS_VIEW)
  listCheques(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query('status') status?: string,
  ) {
    return this.cashBank.listCheques(businessId, branchId, status);
  }

  @Post('cheques/:id/settle')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  settleCheque(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { accountId: string; transferDate?: string },
  ) {
    return this.cashBank.settleCheque(businessId, id, body);
  }

  @Post('cheques/:id/reopen')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  reopenCheque(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.cashBank.reopenCheque(businessId, id);
  }

  @Get('loans')
  @RequirePermissions(Permission.REPORTS_VIEW)
  listLoans(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.cashBank.listLoans(businessId, branchId);
  }

  @Post('loans')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  createLoan(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: Parameters<CashBankService['createLoan']>[2],
  ) {
    return this.cashBank.createLoan(businessId, branchId, body);
  }

  @Post('loans/:id/txns')
  @RequirePermissions(Permission.EXPENSE_MANAGE)
  createLoanTxn(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: Parameters<CashBankService['createLoanTxn']>[2],
  ) {
    return this.cashBank.createLoanTxn(businessId, id, body);
  }
}
