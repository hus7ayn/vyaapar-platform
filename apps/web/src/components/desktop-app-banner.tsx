'use client';

import { Monitor } from 'lucide-react';
import { isDesktopApp } from '@/lib/desktop';

/**
 * Shown at top of app when running inside the Windows desktop shell. The
 * desktop app is a thin client to the same central server the browser app
 * uses — there's no separate local-only dataset to summarize and push, so
 * unlike the old local-Postgres-per-shop model, no background sync runs here.
 */
export function DesktopAppBanner() {
  if (!isDesktopApp()) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium bg-[hsl(348,85%,52%)] text-white"
    >
      <Monitor className="h-3.5 w-3.5" />
      <span>Desktop app — connected to your server</span>
    </div>
  );
}
