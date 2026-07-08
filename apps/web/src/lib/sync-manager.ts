import { getOfflineDB } from './offline-db';
import { api } from './api';

const SYNC_INTERVAL_MS = 15_000;
const MAX_SYNC_ATTEMPTS = 5;

let syncInFlight = false;

export async function processSyncQueue(token: string, clientId: string) {
  if (syncInFlight || !navigator.onLine) return { synced: 0, pending: 0 };

  const db = await getOfflineDB();
  const all = await db.getAll('syncQueue');
  const pending = all.filter((p) => (p.attempts ?? 0) < MAX_SYNC_ATTEMPTS);
  if (!pending.length) return { synced: 0, pending: 0 };

  syncInFlight = true;
  try {
    const result = await api<{ synced: number }>('/sync/push', {
      method: 'POST',
      token,
      body: JSON.stringify({
        clientId,
        operations: pending.map((p) => ({
          entity: p.entity,
          action: p.action,
          payload: p.payload,
        })),
      }),
      retries: 2,
    });

    const tx = db.transaction('syncQueue', 'readwrite');
    await Promise.all(pending.map((p) => tx.store.delete(p.id)));
    await tx.done;

    return { synced: result.synced ?? pending.length, pending: 0 };
  } catch {
    const updated = await Promise.all(
      pending.map(async (p) => {
        const attempts = (p.attempts ?? 0) + 1;
        await db.put('syncQueue', { ...p, attempts });
        return attempts;
      }),
    );
    const remaining = updated.filter((a) => a < MAX_SYNC_ATTEMPTS).length;
    return { synced: 0, pending: remaining };
  } finally {
    syncInFlight = false;
  }
}

export async function getPendingSyncCount(): Promise<number> {
  const db = await getOfflineDB();
  const pending = await db.getAll('syncQueue');
  return pending.filter((p) => (p.attempts ?? 0) < MAX_SYNC_ATTEMPTS).length;
}

export function startSyncInterval(token: string, clientId: string, intervalMs = SYNC_INTERVAL_MS) {
  if (typeof window === 'undefined') return () => undefined;

  const run = () => processSyncQueue(token, clientId);

  run();
  const id = setInterval(run, intervalMs);

  const onOnline = () => run();
  window.addEventListener('online', onOnline);

  return () => {
    clearInterval(id);
    window.removeEventListener('online', onOnline);
  };
}
