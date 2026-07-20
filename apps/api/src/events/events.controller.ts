import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { JwtPayload } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsGateway } from './events.gateway';

@Controller('events')
export class EventsController {
  constructor(private events: EventsGateway) {}

  /**
   * Pusher private-channel auth. The caller can only subscribe to channels
   * scoped to their own business/branch/user — otherwise one tenant could
   * listen in on another tenant's live order/inventory/notification feed.
   */
  @Post('pusher/auth')
  authorizeChannel(@Body() body: { socket_id: string; channel_name: string }, @CurrentUser() user: JwtPayload) {
    const { socket_id, channel_name } = body;
    const allowed =
      channel_name === `private-business-${user.businessId}` ||
      (!!user.branchId && channel_name === `private-branch-${user.branchId}`) ||
      channel_name === `private-user-${user.sub}`;

    if (!allowed) throw new ForbiddenException('Not authorized for this channel');

    return this.events.authorizeChannel(socket_id, channel_name);
  }
}
