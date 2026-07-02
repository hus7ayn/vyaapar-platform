import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SuperAdmin } from '../common/decorators/super-admin.decorator';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PlatformService } from './platform.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/create-tenant.dto';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
@UseGuards(SuperAdminGuard, PermissionsGuard)
@SuperAdmin()
export class PlatformController {
  constructor(private platform: PlatformService) {}

  @Get('stats')
  getStats() {
    return this.platform.getStats();
  }

  @Get('tenants')
  listTenants(@Query() query: PaginationDto) {
    return this.platform.listTenants(query);
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.platform.getTenant(id);
  }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.platform.createTenant(dto);
  }

  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.platform.updateTenant(id, dto);
  }

  @Get('audit-logs')
  auditLogs(@Query() query: PaginationDto) {
    return this.platform.listAuditLogs(query);
  }
}
