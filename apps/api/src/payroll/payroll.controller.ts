import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { EmployeeInput, PayrollService } from './payroll.service';

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
@UseGuards(PermissionsGuard)
export class PayrollController {
  constructor(private payroll: PayrollService) {}

  @Get('employees')
  @RequirePermissions(Permission.PAYROLL_VIEW)
  employees(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.payroll.getEmployees(businessId, branchId);
  }

  @Post('employees')
  @RequirePermissions(Permission.PAYROLL_MANAGE)
  createEmployee(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Body() body: EmployeeInput,
  ) {
    return this.payroll.createEmployee(businessId, branchId, body);
  }

  @Patch('employees/:id')
  @RequirePermissions(Permission.PAYROLL_MANAGE)
  updateEmployee(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: Partial<EmployeeInput> & { isActive?: boolean },
  ) {
    return this.payroll.updateEmployee(businessId, id, body);
  }

  @Post('employees/:id/advance')
  @RequirePermissions(Permission.PAYROLL_MANAGE)
  recordAdvance(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { amount: number },
  ) {
    return this.payroll.recordAdvance(businessId, id, body.amount);
  }

  @Get('summary')
  @RequirePermissions(Permission.PAYROLL_VIEW)
  summary(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.payroll.payrollSummary(businessId, branchId, from, to);
  }

  @Get()
  @RequirePermissions(Permission.PAYROLL_VIEW)
  list(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string | undefined,
  ) {
    return this.payroll.getPayrolls(businessId, branchId);
  }

  @Post('generate')
  @RequirePermissions(Permission.PAYROLL_MANAGE)
  generate(
    @CurrentUser('businessId') businessId: string,
    @Body() body: { startDate: string; endDate: string },
  ) {
    // Business-wide: generates a payroll run (for the given date range) for every shop's active staff.
    return this.payroll.generatePayroll(businessId, body.startDate, body.endDate);
  }

  @Patch(':payrollId/lines/:lineId')
  @RequirePermissions(Permission.PAYROLL_MANAGE)
  updateLine(
    @CurrentUser('businessId') businessId: string,
    @Param('payrollId') payrollId: string,
    @Param('lineId') lineId: string,
    @Body() body: { overtime?: number; bonus?: number; deductions?: number; advance?: number },
  ) {
    return this.payroll.updateLine(businessId, payrollId, lineId, body);
  }

  @Post(':payrollId/pay')
  @RequirePermissions(Permission.PAYROLL_MANAGE)
  pay(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
    @Param('payrollId') payrollId: string,
    @Body() body: { paymentType?: string; bankAccountId?: string },
  ) {
    return this.payroll.payPayroll(businessId, userId, payrollId, body);
  }

  @Post('attendance')
  @RequirePermissions(Permission.PAYROLL_MANAGE)
  attendance(@Body() body: { employeeId: string; date: string; checkIn?: string; checkOut?: string }) {
    return this.payroll.recordAttendance(body.employeeId, body);
  }

  @Get('attendance/:employeeId')
  @RequirePermissions(Permission.PAYROLL_VIEW)
  getAttendance(@Param('employeeId') employeeId: string) {
    return this.payroll.getAttendance(employeeId);
  }
}
