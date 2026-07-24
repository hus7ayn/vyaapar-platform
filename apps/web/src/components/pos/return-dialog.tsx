'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { Txn } from '@/lib/txn-meta';

/**
 * Return / Exchange picker for a single sale invoice — select specific items,
 * then Refund (cash) or Exchange. Reused by POS Recent Bills and the Sale
 * Invoices list (return by bill number). Uses the backend partial-refund
 * (lineIds) endpoint; omitting lineIds when all are selected = full-invoice refund.
 */
export function ReturnDialog({
  invoiceId,
  token,
  onClose,
  onDone,
}: {
  invoiceId: string;
  token?: string;
  onClose: () => void;
  onDone?: (mode: 'REFUND' | 'EXCHANGE') => void;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const { data: invoice } = useQuery({
    queryKey: ['invoice-detail', invoiceId],
    queryFn: () => api<Txn>(`/txns/${invoiceId}`, { token }),
    enabled: !!invoiceId,
  });

  useEffect(() => {
    if (invoice?.lines) {
      const all: Record<string, boolean> = {};
      invoice.lines.forEach((l) => { if (l.id) all[l.id] = true; });
      setSelected(all);
    }
  }, [invoice]);

  const refund = useMutation({
    mutationFn: (mode: 'REFUND' | 'EXCHANGE') => {
      const lines = invoice?.lines ?? [];
      const selectedIds = lines.filter((l) => l.id && selected[l.id]).map((l) => l.id as string);
      const allSelected = selectedIds.length === lines.length;
      const body: { mode: 'REFUND' | 'EXCHANGE'; lineIds?: string[] } = { mode };
      if (!allSelected) body.lineIds = selectedIds; // omit -> full-invoice refund
      return api(`/sale/invoices/${invoiceId}/refund`, { method: 'POST', token, body: JSON.stringify(body) });
    },
    onSuccess: (_res, mode) => {
      toast.success(mode === 'EXCHANGE'
        ? 'Items returned — ring up the replacement now'
        : 'Return processed — credit note created, cash refunded');
      onDone?.(mode);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Return failed'),
  });

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">Return items{invoice ? ` — ${invoice.txnNumber}` : ''}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {!invoice && <p className="text-center text-muted-foreground">Loading…</p>}
          {(invoice?.lines ?? []).map((l) => (
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
            <Button variant="outline" className="flex-1" disabled={!selectedCount || refund.isPending} onClick={() => refund.mutate('EXCHANGE')}>
              Exchange
            </Button>
            <Button className="flex-1" disabled={!selectedCount || refund.isPending} onClick={() => refund.mutate('REFUND')}>
              Refund (cash)
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
