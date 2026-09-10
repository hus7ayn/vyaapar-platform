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
// getTxn attaches returnedQty per line so we can cap each picker at (purchased − already returned).
type ReturnLine = NonNullable<Txn['lines']>[number] & { returnedQty?: number | string };

/**
 * Return / Exchange for a sale invoice, at QUANTITY granularity. Each line shows a quantity
 * input capped at the units still returnable (purchased − already returned). Refund pays cash
 * back for the chosen quantities; Exchange returns them and rings up replacement item(s) so the
 * customer settles only the difference. Inventory + refund follow the returned quantity only.
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
  const [returnQty, setReturnQty] = useState<Record<string, number>>({}); // lineId -> qty to return
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

  const lines = (invoice?.lines ?? []) as ReturnLine[];
  const purchasedOf = (l: ReturnLine) => Number(l.quantity) || 0;
  const remainingOf = (l: ReturnLine) => Math.max(0, purchasedOf(l) - Number(l.returnedQty ?? 0));
  const qtyOf = (l: ReturnLine) => (l.id ? returnQty[l.id] ?? 0 : 0);

  const rows = lines
    .filter((l) => l.id && qtyOf(l) > 0)
    .map((l) => ({ lineId: l.id as string, quantity: qtyOf(l) }));
  // Per-unit share of the stored line total (already includes that line's discount + tax) — this
  // exactly matches the backend's per-quantity refund math for both flat and % discounts.
  const returnedTotal = lines.reduce((s, l) => {
    const purchased = purchasedOf(l) || 1;
    return s + (Number(l.total ?? 0) * qtyOf(l)) / purchased;
  }, 0);

  // What each item on THIS invoice was actually sold for — the historical unit price net of the
  // line discount that was given at the till, plus the tax rate charged at the time. An exchange
  // must be priced off this, never off the catalogue's current salePrice, so a price the shop
  // changed later (or a discount already granted) can't silently re-price the swap. Mirrors
  // SaleService.exchangeInvoice, which builds the replacement lines the same way.
  const soldAs = new Map<string, { unitPrice: number; taxRate: number }>();
  for (const l of lines) {
    const itemId = l.itemId ?? undefined;
    if (!itemId || soldAs.has(itemId)) continue;
    const soldQty = purchasedOf(l) || 1;
    soldAs.set(itemId, {
      unitPrice: Number(l.unitPrice) - Number(l.discountAmount ?? 0) / soldQty,
      taxRate: Number(l.taxRate) || 0,
    });
  }
  /** Exchange price for an item: what it was sold for on this bill, else its current sale price. */
  const priceOf = (it: CatalogItem) =>
    soldAs.get(it.id) ?? { unitPrice: Number(it.salePrice), taxRate: Number(it.taxRate) || 0 };

  const catalogItems = catalog ?? [];
  const replacementRows = Object.entries(replacements).filter(([, q]) => q > 0);
  const newTotal = replacementRows.reduce((sum, [itemId, qty]) => {
    const it = catalogItems.find((c) => c.id === itemId);
    if (!it) return sum;
    const { unitPrice, taxRate } = priceOf(it);
    return sum + unitPrice * qty * (1 + taxRate / 100);
  }, 0);
  const diff = newTotal - returnedTotal;

  const setQty = (l: ReturnLine, value: number) => {
    if (!l.id) return;
    const capped = Math.max(0, Math.min(remainingOf(l), Math.floor(value)));
    setReturnQty((s) => ({ ...s, [l.id as string]: capped }));
  };

  const refund = useMutation({
    mutationFn: () =>
      api(`/sale/invoices/${invoiceId}/refund`, {
        method: 'POST',
        token,
        body: JSON.stringify({ mode: 'REFUND', returns: rows }),
      }),
    onSuccess: () => { toast.success('Return processed — credit note created, cash refunded'); onDone?.('REFUND'); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Return failed'),
  });

  const exchange = useMutation({
    mutationFn: () =>
      api(`/sale/invoices/${invoiceId}/exchange`, {
        method: 'POST',
        token,
        body: JSON.stringify({ returns: rows, replacements: replacementRows.map(([itemId, quantity]) => ({ itemId, quantity })) }),
      }),
    onSuccess: () => { toast.success('Exchange complete — items swapped'); onDone?.('EXCHANGE'); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Exchange failed'),
  });

  const busy = refund.isPending || exchange.isPending;
  const totalUnits = rows.reduce((s, r) => s + r.quantity, 0);
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
              <p className="text-xs text-muted-foreground">Set how many units of each item to return.</p>
              {lines.map((l) => {
                const remaining = remainingOf(l);
                const purchased = purchasedOf(l);
                const alreadyReturned = Number(l.returnedQty ?? 0);
                return (
                  <div key={l.id} className={`flex items-center gap-3 p-2 rounded-lg border ${remaining === 0 ? 'opacity-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {/* The price the customer was actually charged per unit (net of the line
                            discount on this bill) — not the item's list price. */}
                        {purchased} {l.unit} × {formatCurrency(Number(l.unitPrice) - Number(l.discountAmount ?? 0) / (purchased || 1))}
                        {alreadyReturned > 0 ? ` · ${alreadyReturned} returned` : ''}
                        {remaining === 0 ? ' · fully returned' : ` · ${remaining} returnable`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="h-7 w-7 rounded border text-sm disabled:opacity-40"
                        disabled={remaining === 0 || qtyOf(l) <= 0}
                        onClick={() => setQty(l, qtyOf(l) - 1)}
                      >−</button>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        className="w-14 h-7 rounded border px-2 text-right text-sm"
                        value={qtyOf(l)}
                        disabled={remaining === 0}
                        onChange={(e) => setQty(l, Number(e.target.value))}
                      />
                      <button
                        type="button"
                        className="h-7 w-7 rounded border text-sm disabled:opacity-40"
                        disabled={remaining === 0 || qtyOf(l) >= remaining}
                        onClick={() => setQty(l, qtyOf(l) + 1)}
                      >+</button>
                      <button
                        type="button"
                        className="h-7 px-2 rounded border text-[11px] disabled:opacity-40"
                        disabled={remaining === 0}
                        onClick={() => setQty(l, remaining)}
                      >All</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t space-y-2">
              <p className="text-xs text-muted-foreground">{totalUnits} unit(s) selected · returning {formatCurrency(returnedTotal)}. Inventory is restored automatically.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={!rows.length || busy} onClick={() => setStep('replace')}>
                  Exchange →
                </Button>
                <Button className="flex-1" disabled={!rows.length || busy} onClick={() => refund.mutate()}>
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
                        <span className="w-20 text-right">{formatCurrency(it ? priceOf(it).unitPrice * qty : 0)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!catalog && <p className="text-center text-muted-foreground">Loading catalog…</p>}
              {filtered.map((it) => {
                const sold = soldAs.get(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-lg border hover:bg-accent text-left"
                    onClick={() => setReplacements((r) => ({ ...r, [it.id]: (r[it.id] ?? 0) + 1 }))}
                  >
                    <span className="text-sm truncate">{it.name}</span>
                    <span className="text-sm font-medium shrink-0 text-right">
                      {formatCurrency(priceOf(it).unitPrice)}
                      {sold && <span className="block text-[10px] font-normal text-muted-foreground">as sold on this bill</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="p-4 border-t space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Returning {formatCurrency(returnedTotal)}</span>
                <span>New items {formatCurrency(newTotal)}</span>
              </div>
              <p className="text-sm font-semibold">
                {diff >= 0 ? `Customer pays ${formatCurrency(diff)}` : `Refund customer ${formatCurrency(-diff)}`}
              </p>
              <Button className="w-full" disabled={!replacementRows.length || !rows.length || busy} onClick={() => exchange.mutate()}>
                Complete exchange
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
