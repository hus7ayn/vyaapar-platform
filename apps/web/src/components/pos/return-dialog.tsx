'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/utils';
import { Txn } from '@/lib/txn-meta';

interface CatalogItem { id: string; name: string; salePrice: number | string; taxRate: number | string }

/**
 * Return / Exchange for a sale invoice. Items start UNSELECTED — tick the ones
 * to return (so "return this item" is explicit and partial refunds actually work).
 * Refund pays cash back for the ticked items. Exchange returns the ticked items
 * AND lets the user pick replacement item(s), ringing up a new sale (backend
 * exchangeInvoice), so the customer only settles the difference.
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
  const [selected, setSelected] = useState<Record<string, boolean>>({}); // default: nothing selected
  const [step, setStep] = useState<'items' | 'replace'>('items');
  const [search, setSearch] = useState('');
  const [replacements, setReplacements] = useState<Record<string, number>>({}); // itemId -> qty

  const { data: invoice } = useQuery({
    queryKey: ['invoice-detail', invoiceId],
    queryFn: () => api<Txn>(`/txns/${invoiceId}`, { token }),
    enabled: !!invoiceId,
  });

  const { data: catalog } = useQuery({
    queryKey: ['exchange-catalog'],
    // GET /items returns a bare Item[] (not { items: [] }); read the array directly.
    queryFn: () => api<CatalogItem[]>('/items', { token }),
    enabled: !!token && step === 'replace',
  });

  const lines = invoice?.lines ?? [];
  const selectedIds = lines.filter((l) => l.id && selected[l.id]).map((l) => l.id as string);
  const returnedTotal = lines.filter((l) => l.id && selected[l.id]).reduce((s, l) => s + Number(l.total ?? 0), 0);

  const catalogItems = catalog ?? [];
  const replacementRows = Object.entries(replacements).filter(([, q]) => q > 0);
  const newTotal = replacementRows.reduce((sum, [itemId, qty]) => {
    const it = catalogItems.find((c) => c.id === itemId);
    if (!it) return sum;
    return sum + Number(it.salePrice) * qty * (1 + Number(it.taxRate) / 100);
  }, 0);
  const diff = newTotal - returnedTotal;

  const refund = useMutation({
    mutationFn: () => {
      const allSelected = selectedIds.length === lines.length;
      const body: { mode: 'REFUND'; lineIds?: string[] } = { mode: 'REFUND' };
      if (!allSelected) body.lineIds = selectedIds; // omit only when literally everything is selected
      return api(`/sale/invoices/${invoiceId}/refund`, { method: 'POST', token, body: JSON.stringify(body) });
    },
    onSuccess: () => { toast.success('Return processed — credit note created, cash refunded'); onDone?.('REFUND'); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Return failed'),
  });

  const exchange = useMutation({
    mutationFn: () =>
      api(`/sale/invoices/${invoiceId}/exchange`, {
        method: 'POST',
        token,
        body: JSON.stringify({ lineIds: selectedIds, replacements: replacementRows.map(([itemId, quantity]) => ({ itemId, quantity })) }),
      }),
    onSuccess: () => { toast.success('Exchange complete — items swapped'); onDone?.('EXCHANGE'); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Exchange failed'),
  });

  const busy = refund.isPending || exchange.isPending;
  const filtered = search ? catalogItems.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())) : catalogItems.slice(0, 30);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-bold">
            {step === 'items' ? 'Return items' : 'Choose replacements'}{invoice ? ` — ${invoice.txnNumber}` : ''}
          </h3>
          <Button variant="ghost" size="sm" onClick={step === 'replace' ? () => setStep('items') : onClose}>
            {step === 'replace' ? 'Back' : 'Cancel'}
          </Button>
        </div>

        {step === 'items' && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!invoice && <p className="text-center text-muted-foreground">Loading…</p>}
              <p className="text-xs text-muted-foreground">Tick the item(s) to return.</p>
              {lines.map((l) => (
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
              <p className="text-xs text-muted-foreground">{selectedIds.length} item(s) selected · returning {formatCurrency(returnedTotal)}. Inventory is restored automatically.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={!selectedIds.length || busy} onClick={() => setStep('replace')}>
                  Exchange →
                </Button>
                <Button className="flex-1" disabled={!selectedIds.length || busy} onClick={() => refund.mutate()}>
                  Refund (cash)
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'replace' && (
          <>
            <div className="p-3 border-b">
              <Input placeholder="Search items to give in exchange…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {replacementRows.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Replacements</p>
                  {replacementRows.map(([itemId, qty]) => {
                    const it = catalogItems.find((c) => c.id === itemId);
                    return (
                      <div key={itemId} className="flex items-center gap-2 text-sm py-1">
                        <span className="flex-1 truncate">{it?.name ?? 'Item'}</span>
                        <input
                          type="number" min={1} className="w-16 h-8 rounded border px-2 text-right text-sm"
                          value={qty}
                          onChange={(e) => setReplacements((r) => ({ ...r, [itemId]: Math.max(0, Number(e.target.value)) }))}
                        />
                        <span className="w-20 text-right">{formatCurrency(Number(it?.salePrice ?? 0) * qty)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!catalog && <p className="text-center text-muted-foreground">Loading catalog…</p>}
              {filtered.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="w-full flex items-center justify-between p-2 rounded-lg border hover:bg-accent text-left"
                  onClick={() => setReplacements((r) => ({ ...r, [it.id]: (r[it.id] ?? 0) + 1 }))}
                >
                  <span className="text-sm truncate">{it.name}</span>
                  <span className="text-sm font-medium">{formatCurrency(Number(it.salePrice))}</span>
                </button>
              ))}
            </div>
            <div className="p-4 border-t space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Returning {formatCurrency(returnedTotal)}</span>
                <span>New items {formatCurrency(newTotal)}</span>
              </div>
              <p className="text-sm font-semibold">
                {diff >= 0 ? `Customer pays ${formatCurrency(diff)}` : `Refund customer ${formatCurrency(-diff)}`}
              </p>
              <Button className="w-full" disabled={!replacementRows.length || busy} onClick={() => exchange.mutate()}>
                Complete exchange
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
