'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, RefreshCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/utils';
import { PermissionGate } from '@/components/permission-gate';
import { Permission } from '@nexus/shared';
import { Txn } from '@/lib/txn-meta';

export function RecentOrdersPanel({ branchId }: { branchId?: string }) {
  const token = useAuthStore((s) => s.accessToken)!;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['recent-invoices', branchId, search],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '10', search });
      if (branchId) qs.set('branchId', branchId);
      return api<{ data: Txn[] }>(`/sale/invoices?${qs}`, { token });
    },
    enabled: open,
    refetchInterval: open ? 10000 : false,
  });

  const refund = useMutation({
    mutationFn: (txnId: string) =>
      api(`/sale/invoices/${txnId}/refund`, { method: 'POST', token, body: JSON.stringify({}) }),
    onSuccess: () => {
      toast.success('Invoice refunded');
      queryClient.invalidateQueries({ queryKey: ['recent-invoices'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Refund failed'),
  });

  const orders = data?.data ?? [];

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)} className="gap-2 shrink-0">
        <Clock className="h-4 w-4" /> Recent Bills
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">Recent Sale Invoices</h3>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
            </div>
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search invoice # or party"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {isLoading && <p className="text-center text-muted-foreground">Loading…</p>}
              {orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{o.txnNumber}</p>
                    <p className="text-xs text-muted-foreground">{o.partyName ?? 'Walk-in'} · {o.status}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{formatCurrency(Number(o.total))}</span>
                    {o.status !== 'REFUNDED' && (
                      <PermissionGate permission={Permission.POS_REFUND}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-amber-600"
                          disabled={refund.isPending}
                          onClick={() => { if (confirm(`Return / refund ${o.txnNumber} in full? A credit note will be created.`)) refund.mutate(o.id); }}
                        >
                          <RefreshCcw className="h-3.5 w-3.5" /> Return
                        </Button>
                      </PermissionGate>
                    )}
                  </div>
                </div>
              ))}
              {!isLoading && !orders.length && (
                <p className="text-center text-muted-foreground py-8">No recent invoices</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
