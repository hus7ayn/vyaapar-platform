import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/events' })
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('join')
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() room: string) {
    if (room?.startsWith('business:') || room?.startsWith('branch:')) {
      client.join(room);
    }
    return { joined: room };
  }

  emitOrderUpdate(businessId: string, branchId: string, order: unknown) {
    this.server?.to(`business:${businessId}`).emit('order:updated', order);
    this.server?.to(`branch:${branchId}`).emit('order:updated', order);
  }

  emitRoomUpdate(businessId: string, room: unknown) {
    this.server?.to(`business:${businessId}`).emit('room:updated', room);
  }

  emitInventoryUpdate(businessId: string, data: unknown) {
    this.server?.to(`business:${businessId}`).emit('inventory:updated', data);
  }

  emitNotification(businessId: string, userId: string | null, data: unknown) {
    this.server?.to(`business:${businessId}`).emit('notification:new', data);
    if (userId) this.server?.to(`user:${userId}`).emit('notification:new', data);
  }
}
