import { api } from './api';

export interface DailyInsight {
  date: string;
  salesRevenue: number;
  purchaseTotal: number;
  expenseTotal: number;
  invoiceCount: number;
  taxCollected: number;
  profitEstimate?: number;
}

const CLOUD_URL_KEY = 'vyaapar-insights-cloud-url';
const LAST_SYNC_KEY = 'vyaapar-insights-last-sync';

export function getInsightsCloudUrl(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(CLOUD_URL_KEY) || process.env.NEXT_PUBLIC_INSIGHTS_CLOUD_URL || '';
}

export function setInsightsCloudUrl(url: string) {
  localStorage.setItem(CLOUD_URL_KEY, url.trim());
}

export function getLastInsightsSync(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

function setLastInsightsSync(iso: string) {
  localStorage.setItem(LAST_SYNC_KEY, iso);
}

export async function syncInsightsToCloud(opts: {
  token: string;
  branchId: string;
  deviceId: string;
  cloudUrl?: string;
}): Promise<{ ok: boolean; synced: number; error?: string }> {
  const cloudUrl = (opts.cloudUrl || getInsightsCloudUrl()).replace(/\/$/, '');
  if (!cloudUrl) {
    return { ok: false, synced: 0, error: 'Set cloud URL in Settings → Cloud sync' };
  }
  if (!opts.branchId) {
    return { ok: false, synced: 0, error: 'Select a shop/branch first' };
  }

  try {
    const insights = await api<DailyInsight[]>('/insights/daily-local', {
      token: opts.token,
      branchId: opts.branchId,
    });

    if (!insights.length) {
      return { ok: true, synced: 0 };
    }

    const res = await fetch(`${cloudUrl}/api/v1/insights/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
        'x-branch-id': opts.branchId,
      },
      body: JSON.stringify({
        deviceId: opts.deviceId,
        branchId: opts.branchId,
        insights,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        ok: false,
        synced: 0,
        error: (err as { message?: string }).message ?? `Cloud error ${res.status}`,
      };
    }

    const data = (await res.json()) as { upserted?: number };
    setLastInsightsSync(new Date().toISOString());
    return { ok: true, synced: data.upserted ?? insights.length };
  } catch (e) {
    return {
      ok: false,
      synced: 0,
      error: e instanceof Error ? e.message : 'Sync failed',
    };
  }
}
