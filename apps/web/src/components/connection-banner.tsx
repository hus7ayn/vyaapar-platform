'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, CloudOff, Loader2 } from 'lucide-react';
import { getPendingSyncCount } from '@/lib/sync-manager';
import { checkApiHealth } from '@/lib/api';

export function ConnectionBanner() {
  const [online, setOnline] = useState(true);
  const [apiOk, setApiOk] = useState(true);
  const [pending, setPending] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      setChecking(true);
      const [ok, count] = await Promise.all([
        navigator.onLine ? checkApiHealth() : Promise.resolve(false),
        getPendingSyncCount(),
      ]);
      if (active) {
        setApiOk(ok);
        setPending(count);
        setChecking(false);
      }
    };
    poll();
    const id = setInterval(poll, 20_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [online]);

  if (online && apiOk && pending === 0) return null;

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium ${
        !online || !apiOk
          ? 'bg-amber-500 text-amber-950'
          : 'bg-blue-600 text-white'
      }`}
    >
      {checking ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : !online ? (
        <WifiOff className="h-4 w-4" />
      ) : !apiOk ? (
        <CloudOff className="h-4 w-4" />
      ) : (
        <Wifi className="h-4 w-4" />
      )}
      <span>
        {!online
          ? 'Offline — sales are saved locally and sync when back online'
          : !apiOk
            ? 'Cannot reach server — using cached data where possible'
            : `${pending} sale(s) waiting to sync`}
      </span>
    </div>
  );
}
