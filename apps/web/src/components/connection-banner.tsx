'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { getPendingSyncCount } from '@/lib/sync-manager';
import { checkApiHealth } from '@/lib/api';

export function ConnectionBanner() {
  const [apiOk, setApiOk] = useState(true);
  const [pending, setPending] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    // Source of truth is SERVER reachability (checkApiHealth), NOT navigator.onLine, which is
    // unreliable and made the banner show "Offline" even when the internet was fine.
    const poll = async () => {
      setChecking(true);
      const [ok, count] = await Promise.all([checkApiHealth(), getPendingSyncCount()]);
      if (active) {
        setApiOk(ok);
        setPending(count);
        setChecking(false);
      }
    };
    poll();
    const id = setInterval(poll, 20_000);
    // navigator online/offline events only trigger an immediate re-check (a hint, not truth).
    const recheck = () => poll();
    window.addEventListener('online', recheck);
    window.addEventListener('offline', recheck);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', recheck);
    };
  }, []);

  if (apiOk && pending === 0) return null;

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium ${
        !apiOk ? 'bg-amber-500 text-amber-950' : 'bg-blue-600 text-white'
      }`}
    >
      {checking ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : !apiOk ? (
        <WifiOff className="h-4 w-4" />
      ) : (
        <Wifi className="h-4 w-4" />
      )}
      <span>
        {!apiOk
          ? 'Offline — sales are saved locally and will sync when the server is reachable'
          : `Syncing ${pending} sale(s)…`}
      </span>
    </div>
  );
}
