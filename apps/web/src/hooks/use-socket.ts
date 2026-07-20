'use client';

import { useEffect, useRef } from 'react';
import Pusher, { Channel } from 'pusher-js';
import { useAuthStore } from '@/stores/auth-store';

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || '';
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// One Pusher connection for the whole app — hook instances share it and just
// bind/unbind their own event on the same business channel.
let client: Pusher | null = null;

function getClient(getToken: () => string | null) {
  if (client) return client;
  client = new Pusher(PUSHER_KEY, {
    cluster: PUSHER_CLUSTER,
    channelAuthorization: {
      transport: 'ajax',
      endpoint: `${API_URL}/api/v1/events/pusher/auth`,
      customHandler: ({ socketId, channelName }, callback) => {
        fetch(`${API_URL}/api/v1/events/pusher/auth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getToken() ?? ''}`,
          },
          body: JSON.stringify({ socket_id: socketId, channel_name: channelName }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`Pusher auth failed: ${res.status}`);
            return res.json();
          })
          .then((data) => callback(null, data))
          .catch((err) => callback(err as Error, null));
      },
    },
  });
  return client;
}

export function useSocket(event: string, handler: (data: unknown) => void) {
  const channelRef = useRef<Channel | null>(null);
  const businessId = useAuthStore((s) => s.user?.businessId);

  useEffect(() => {
    if (!businessId || !PUSHER_KEY) return;

    const pusher = getClient(() => useAuthStore.getState().accessToken);
    const channel = pusher.subscribe(`private-business-${businessId}`);
    channelRef.current = channel;
    channel.bind(event, handler);

    return () => {
      channel.unbind(event, handler);
    };
  }, [businessId, event, handler]);
}
