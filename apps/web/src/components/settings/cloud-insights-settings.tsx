'use client';

import { useEffect, useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/auth-store';
import { getDesktopDeviceId } from '@/lib/desktop';
import {
  getInsightsCloudUrl,
  getLastInsightsSync,
  setInsightsCloudUrl,
  syncInsightsToCloud,
} from '@/lib/insights-sync';

export function CloudInsightsSettings() {
  const token = useAuthStore((s) => s.accessToken)!;
  const branchId = useAuthStore((s) => s.activeShopId);
  const [cloudUrl, setCloudUrl] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setCloudUrl(getInsightsCloudUrl() || process.env.NEXT_PUBLIC_API_URL || '');
    setLastSync(getLastInsightsSync());
  }, []);

  const saveUrl = () => {
    setInsightsCloudUrl(cloudUrl);
    toast.success('Cloud URL saved');
  };

  const syncNow = async () => {
    if (!branchId) {
      toast.error('Select a shop from the top bar first');
      return;
    }
    setSyncing(true);
    try {
      const deviceId = (await getDesktopDeviceId()) ?? `web-${crypto.randomUUID()}`;
      const result = await syncInsightsToCloud({
        token,
        branchId,
        deviceId,
        cloudUrl,
      });
      if (result.ok) {
        setLastSync(getLastInsightsSync());
        toast.success(
          result.synced
            ? `Uploaded ${result.synced} day(s) of revenue insights`
            : 'Nothing new to upload',
        );
      } else {
        toast.error(result.error ?? 'Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Cloud className="h-5 w-5 text-[hsl(348,85%,52%)]" />
        <h2 className="font-semibold">Cloud insights sync</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        The desktop and web apps both talk to your server directly — this is an optional extra
        summary upload, not how your regular data gets there. Full invoices are never uploaded here.
      </p>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Cloud API URL</label>
        <Input
          value={cloudUrl}
          onChange={(e) => setCloudUrl(e.target.value)}
          placeholder="https://your-server.com"
        />
        <p className="text-xs text-muted-foreground">
          Your deployed server (GCP/Oracle). Leave as localhost when testing locally.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={saveUrl}>
          Save URL
        </Button>
        <Button size="sm" className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]" onClick={syncNow} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Sync insights now
        </Button>
      </div>

      {lastSync && (
        <p className="text-xs text-muted-foreground">
          Last sync: {new Date(lastSync).toLocaleString()}
        </p>
      )}
    </Card>
  );
}
