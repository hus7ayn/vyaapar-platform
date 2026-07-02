'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import { getDesktopDeviceId, isDesktopApp } from '@/lib/desktop';
import { syncInsightsToCloud } from '@/lib/insights-sync';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Auto-upload daily revenue summaries to cloud when running in the Windows desktop app. */
export function useDesktopInsightsSync() {
  const token = useAuthStore((s) => s.accessToken);
  const branchId = useAuthStore((s) => s.activeShopId);
  const deviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDesktopApp() || !token || !branchId) return;

    let cancelled = false;

    const run = async () => {
      if (!navigator.onLine) return;
      if (!deviceIdRef.current) {
        deviceIdRef.current = await getDesktopDeviceId();
      }
      if (!deviceIdRef.current || cancelled) return;

      const result = await syncInsightsToCloud({
        token,
        branchId,
        deviceId: deviceIdRef.current,
      });

      if (cancelled) return;
      if (result.synced > 0) {
        toast.success(`Cloud insights updated (${result.synced} day${result.synced === 1 ? '' : 's'})`);
      }
    };

    run();
    const id = setInterval(run, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, branchId]);
}
