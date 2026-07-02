'use client';

import { NotificationBell } from './notification-bell';
import { useAuthStore } from '@/stores/auth-store';
import { ROLE_LABELS, SystemRole } from '@nexus/shared';

export function TopBar() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/95 backdrop-blur px-4 lg:px-6">
      <p className="text-sm font-bold lg:hidden text-[hsl(348,85%,52%)]">Vyaapar</p>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium leading-none">{user?.email}</p>
          <p className="text-xs text-muted-foreground">
            {ROLE_LABELS[user?.role as SystemRole] ?? user?.role}
          </p>
        </div>
      </div>
    </header>
  );
}
