'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';

export function useSocket(event: string, handler: (data: unknown) => void) {
  const socketRef = useRef<Socket | null>(null);
  const businessId = useAuthStore((s) => s.user?.businessId);

  useEffect(() => {
    if (!businessId) return;

    const socket = io(`${WS_URL}/events`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', `business:${businessId}`);
    });

    socket.on(event, handler);

    return () => {
      socket.off(event, handler);
      socket.disconnect();
    };
  }, [businessId, event, handler]);
}
