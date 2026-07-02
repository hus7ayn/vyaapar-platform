import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(PermissionsGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get('logs')
  @RequirePermissions(Permission.AUDIT_VIEW)
  logs(@CurrentUser('businessId') businessId: string) {
    return this.audit.findAll(businessId);
  }
}
