'use client';

import { useEffect, useState } from 'react';
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
  const [returnForId, setReturnForId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

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

  // Full invoice (with lines) for the return dialog.
  const { data: returnTxn } = useQuery({
    queryKey: ['invoice-detail', returnForId],
    queryFn: () => api<Txn>(`/txns/${returnForId}`, { token }),
    enabled: !!returnForId,
  });

  useEffect(() => {
    if (returnTxn?.lines) {
      const all: Record<string, boolean> = {};
      returnTxn.lines.forEach((l) => { if (l.id) all[l.id] = true; });
      setSelected(all);
    }
  }, [returnTxn]);

  const closeReturn = () => { setReturnForId(null); setSelected({}); };

  const refund = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'REFUND' | 'EXCHANGE' }) => {
      const lines = returnTxn?.lines ?? [];
      const selectedIds = lines.filter((l) => l.id && selected[l.id]).map((l) => l.id as string);
      const allSelected = selectedIds.length === lines.length;
      const body: { mode: 'REFUND' | 'EXCHANGE'; lineIds?: string[] } = { mode };
      // Omit lineIds when everything is selected -> full-invoice refund path.
      if (!allSelected) body.lineIds = selectedIds;
      return api(`/sale/invoices/${id}/refund`, { method: 'POST', token, body: JSON.stringify(body) });
    },
    onSuccess: (_res, vars) => {
      toast.success(vars.mode === 'EXCHANGE'
        ? 'Items returned — ring up the replacement now'
        : 'Return processed — credit note created, cash refunded');
      queryClient.invalidateQueries({ queryKey: ['recent-invoices'] });
      closeReturn();
      if (vars.mode === 'EXCHANGE') setOpen(false); // back to POS to sell the replacement
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Return failed'),
  });

  const orders = data?.data ?? [];
  const selectedCount = Object.values(selected).filter(Boolean).length;

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
                          onClick={() => setReturnForId(o.id)}
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

      {/* Return / Exchange dialog — pick items, then Refund (cash) or Exchange (credit + new sale) */}
      {returnForId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">Return items{returnTxn ? ` — ${returnTxn.txnNumber}` : ''}</h3>
              <Button variant="ghost" size="sm" onClick={closeReturn}>Cancel</Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!returnTxn && <p className="text-center text-muted-foreground">Loading…</p>}
              {(returnTxn?.lines ?? []).map((l) => (
                <label key={l.id} className="flex items-center gap-3 p-2 rounded-lg border cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!(l.id && selected[l.id])}
                    onChange={(e) => l.id && setSelected((s) => ({ ...s, [l.id as string]: e.target.checked }))}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{l.name}</p>
                    <p className="text-xs text-muted-foreground">{Number(l.quantity)} {l.unit} × {formatCurrency(Number(l.unitPrice))}</p>
                  </div>
                  <span className="text-sm font-semibold">{formatCurrency(Number(l.total ?? 0))}</span>
                </label>
              ))}
            </div>
            <div className="p-4 border-t space-y-2">
              <p className="text-xs text-muted-foreground">{selectedCount} item(s) selected. Inventory is restored automatically.</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!selectedCount || refund.isPending}
                  onClick={() => returnForId && refund.mutate({ id: returnForId, mode: 'EXCHANGE' })}
                >
                  Exchange
                </Button>
                <Button
                  className="flex-1"
                  disabled={!selectedCount || refund.isPending}
                  onClick={() => returnForId && refund.mutate({ id: returnForId, mode: 'REFUND' })}
                >
                  Refund (cash)
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
