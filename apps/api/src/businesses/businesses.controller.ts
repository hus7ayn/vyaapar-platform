import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { BusinessesService } from './businesses.service';

@ApiTags('businesses')
@ApiBearerAuth()
@Controller('businesses')
@UseGuards(PermissionsGuard)
export class BusinessesController {
  constructor(private businesses: BusinessesService) {}

  @Get('me')
  getProfile(@CurrentUser('businessId') businessId: string) {
    return this.businesses.getProfile(businessId);
  }

  @Patch('me')
  @RequirePermissions(Permission.BUSINESS_MANAGE)
  update(@CurrentUser('businessId') businessId: string, @Body() body: Record<string, unknown>) {
    return this.businesses.update(businessId, body);
  }
}
