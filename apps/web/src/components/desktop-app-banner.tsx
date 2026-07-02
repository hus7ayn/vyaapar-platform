'use client';

import { Monitor } from 'lucide-react';
import { isDesktopApp } from '@/lib/desktop';
import { useDesktopInsightsSync } from '@/hooks/use-desktop-insights-sync';

/** Shown at top of app when running inside the Windows desktop shell. */
export function DesktopAppBanner() {
  useDesktopInsightsSync();

  if (!isDesktopApp()) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium bg-[hsl(348,85%,52%)] text-white"
    >
      <Monitor className="h-3.5 w-3.5" />
      <span>Desktop app — full features on this PC · only revenue insights upload to cloud</span>
    </div>
  );
}
