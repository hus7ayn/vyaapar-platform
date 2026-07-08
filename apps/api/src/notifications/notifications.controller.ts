import { Controller, Get, Patch, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  findAll(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.notifications.findForUser(businessId, userId);
  }

  @Patch(':id/read')
  markRead(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.notifications.markRead(businessId, id);
  }
}
