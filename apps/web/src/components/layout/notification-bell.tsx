'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { useSocket } from '@/hooks/use-socket';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications', { token }),
    refetchInterval: 60000,
  });

  useSocket('notification:new', () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'PATCH', token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = notifications?.filter((n) => !n.isRead).length ?? 0;

  return (
    <details className="relative">
      <summary className="list-none cursor-pointer relative p-2 rounded-lg hover:bg-accent">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </summary>
      <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-card border rounded-xl shadow-xl z-50">
        {notifications?.length ? (
          notifications.slice(0, 10).map((n) => (
            <button
              key={n.id}
              type="button"
              className={cn(
                'w-full text-left p-3 border-b hover:bg-accent transition-colors',
                !n.isRead && 'bg-primary/5',
              )}
              onClick={() => !n.isRead && markRead.mutate(n.id)}
            >
              <p className="font-medium text-sm">{n.title}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
            </button>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground text-center">No notifications</p>
        )}
      </div>
    </details>
  );
}
