import { Injectable } from '@nestjs/common';
import Pusher from 'pusher';

/**
 * Realtime push via Pusher Channels (replaces the old Socket.IO gateway —
 * Vercel serverless functions can't hold a persistent WebSocket connection).
 * Method names/signatures are unchanged from the Socket.IO version so
 * items/sale services didn't need to change.
 */
@Injectable()
export class EventsGateway {
  private pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID || '',
    key: process.env.PUSHER_KEY || '',
    secret: process.env.PUSHER_SECRET || '',
    cluster: process.env.PUSHER_CLUSTER || '',
    useTLS: true,
  });

  /** Authorizes a private channel subscription for the given socket. Called from EventsController after verifying the caller owns the channel. */
  authorizeChannel(socketId: string, channel: string) {
    return this.pusher.authorizeChannel(socketId, channel);
  }

  emitOrderUpdate(businessId: string, branchId: string, order: unknown) {
    const channels = [`private-business-${businessId}`];
    if (branchId) channels.push(`private-branch-${branchId}`);
    this.pusher.trigger(channels, 'order:updated', order).catch(() => {});
  }

  emitInventoryUpdate(businessId: string, data: unknown) {
    this.pusher.trigger(`private-business-${businessId}`, 'inventory:updated', data).catch(() => {});
  }

  emitNotification(businessId: string, userId: string | null, data: unknown) {
    const channels = [`private-business-${businessId}`];
    if (userId) channels.push(`private-user-${userId}`);
    this.pusher.trigger(channels, 'notification:new', data).catch(() => {});
  }
}
