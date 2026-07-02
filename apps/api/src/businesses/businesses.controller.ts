import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BusinessesService } from './businesses.service';

@ApiTags('businesses')
@ApiBearerAuth()
@Controller('businesses')
export class BusinessesController {
  constructor(private businesses: BusinessesService) {}

  @Get('me')
  getProfile(@CurrentUser('businessId') businessId: string) {
    return this.businesses.getProfile(businessId);
  }

  @Patch('me')
  update(@CurrentUser('businessId') businessId: string, @Body() body: never) {
    return this.businesses.update(businessId, body);
  }
}
