import { getOfflineDB } from './offline-db';
import { api, checkApiHealth } from './api';

const SYNC_INTERVAL_MS = 15_000;

let syncInFlight = false;

export async function processSyncQueue(token: string, clientId: string) {
  if (syncInFlight) return { synced: 0, pending: await getPendingSyncCount() };

  const db = await getOfflineDB();
  const all = await db.getAll('syncQueue');
  if (!all.length) return { synced: 0, pending: 0 };

  // Only attempt when the SERVER is actually reachable (navigator.onLine is unreliable and was
  // the reason sync stayed stuck on "Ready to Sync" even when online). When unreachable, keep
  // everything queued and do not burn retries.
  const reachable = await checkApiHealth();
  if (!reachable) return { synced: 0, pending: all.length };

  syncInFlight = true;
  try {
    const result = await api<{ synced: number }>('/sync/push', {
      method: 'POST',
      token,
      body: JSON.stringify({
        clientId,
        operations: all.map((p) => ({
          entity: p.entity,
          action: p.action,
          payload: p.payload,
        })),
      }),
      retries: 2,
    });

    const tx = db.transaction('syncQueue', 'readwrite');
    await Promise.all(all.map((p) => tx.store.delete(p.id)));
    await tx.done;

    return { synced: result.synced ?? all.length, pending: 0 };
  } catch {
    // Reachable but the push failed — keep every row queued (bump attempts only for
    // diagnostics) so nothing is ever silently dropped; they retry on the next tick.
    await Promise.all(all.map((p) => db.put('syncQueue', { ...p, attempts: (p.attempts ?? 0) + 1 })));
    return { synced: 0, pending: all.length };
  } finally {
    syncInFlight = false;
  }
}

export async function getPendingSyncCount(): Promise<number> {
  const db = await getOfflineDB();
  const all = await db.getAll('syncQueue');
  return all.length;
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
