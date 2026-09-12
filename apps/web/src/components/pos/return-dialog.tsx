'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Txn } from '@/lib/txn-meta';

interface CatalogItem {
  id: string;
  name: string;
  salePrice: number | string;
  taxRate: number | string;
  currentStock?: number | string | null;
  trackStock?: boolean;
  itemType?: string;
}
// getTxn attaches returnedQty per line so we can cap each picker at (purchased − already returned).
type ReturnLine = NonNullable<Txn['lines']>[number] & { returnedQty?: number | string };

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Money to the paisa. formatCurrency() renders whole rupees, and a refund is settled in coins. */
const money = (n: number) => `₹${round2(n).toFixed(2)}`;

/**
 * Return / Exchange for a sale invoice, at QUANTITY granularity. Each line shows a quantity
 * input capped at the units still returnable (purchased − already returned). Refund pays cash
 * back for the chosen quantities; Exchange returns them and rings up replacement item(s) so the
 * customer settles only the difference. Inventory + refund follow the returned quantity only.
 *
 * ── What a return is worth ───────────────────────────────────────────────────────────────────
 * Every figure below comes from the SINGLE canonical formula the server uses (see the block
 * comment above SaleService.postReturn in apps/api/src/sale/sale.service.ts), run over the same
 * stored 2-dp numbers with the same expressions in the same order:
 *
 *     goods(q) = Σ over the invoice's lines of  line.total × q(line) / line.quantity
 *     paid(q)  = round2( invoice.total × goods(q) / goods(everything purchased) )
 *     VALUE    = paid(already returned + this return) − paid(already returned)
 *
 * `invoice.total` is what the customer actually handed over, so the bill-level discount, any
 * additional charges and the round-off are all already inside it — none of them can be shown
 * here and then quietly left out of the credit note (the dialog used to prorate the raw stored
 * line total, which is BEFORE the bill discount, and quote ₹505 on a bill that refunded ₹454.50).
 * Because the allocation is cumulative, repeated partial returns always add up to exactly the
 * invoice total, and the popup figure is the figure the till books, to the paisa.
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
  // One key per opened dialog. A retried POST (double tap, or the cashier resending after a
  // timeout) is recognised by the server and returns the credit note the first call committed
  // instead of taking the goods back a second time and paying out twice.
  const [clientId] = useState(
    () => `ret-${invoiceId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );

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
  const purchasedOf = (l: ReturnLine) => num(l.quantity);
  const alreadyOf = (l: ReturnLine) => num(l.returnedQty);
  const remainingOf = (l: ReturnLine) => Math.max(0, round3(purchasedOf(l) - alreadyOf(l)));
  const qtyOf = (l: ReturnLine) => (l.id ? returnQty[l.id] ?? 0 : 0);

  const rows = lines
    .filter((l) => l.id && qtyOf(l) > 0)
    .map((l) => ({ lineId: l.id as string, quantity: qtyOf(l) }));

  // ── the canonical formula, character for character the server's ──────────────────────────
  /** Tax-inclusive value of `qty` units of a line, taken from its STORED total. */
  const lineValue = (l: ReturnLine, qty: number) => {
    const purchased = purchasedOf(l);
    const total = num(l.total);
    if (!(purchased > 0) || !(qty > 0)) return 0;
    return qty >= purchased ? total : (total * qty) / purchased;
  };
  // Summed in line-id order, the order the server sums in, so both float sums are term-identical.
  const ordered = [...lines].sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0));
  const goodsOf = (qtyOf2: (l: ReturnLine) => number) =>
    ordered.reduce((sum, l) => sum + lineValue(l, qtyOf2(l)), 0);
  const invoiceTotal = num(invoice?.total);
  const goodsTotal = goodsOf(purchasedOf);
  const paidShare = (goods: number) => (goodsTotal > 0 ? round2(invoiceTotal * (goods / goodsTotal)) : 0);

  /** What this selection is worth — the exact amount the credit note will be raised for. */
  const refundValue = Math.max(
    0,
    round2(paidShare(goodsOf((l) => alreadyOf(l) + qtyOf(l))) - paidShare(goodsOf(alreadyOf))),
  );
  const returnedGoods = goodsOf(qtyOf);
  /** Per rupee of bill-price goods, what the customer really paid — bill discount, charges and
   *  round-off included. The exchange re-issues returned units at exactly this rate. */
  const creditRate = returnedGoods > 0 ? refundValue / returnedGoods : 0;
  /** Same rate across the whole bill, used only for the per-line "paid ₹X each" caption. */
  const billRate = goodsTotal > 0 ? invoiceTotal / goodsTotal : 0;

  // ── exchange pricing (mirrors SaleService.exchangeInvoice) ────────────────────────────────
  // The old price is an ALLOWANCE, not a price list: one unit at the bill's own effective rate
  // for every unit of that item actually being handed back, taken from the line it came off.
  // Anything beyond the allowance, and any other product, is an ordinary sale at today's price.
  type Allowance = { qty: number; unitPrice: number; netUnitPrice: number; taxRate: number };
  const buildAllowances = () => {
    const map = new Map<string, Allowance[]>();
    for (const l of ordered) {
      const itemId = l.itemId ?? undefined;
      const qty = qtyOf(l);
      const soldQty = purchasedOf(l);
      if (!itemId || qty <= 0 || !(soldQty > 0)) continue;
      const unitPrice = num(l.unitPrice);
      const discountPerUnit =
        l.discountPercent != null ? (unitPrice * num(l.discountPercent)) / 100 : num(l.discountAmount) / soldQty;
      const list = map.get(itemId) ?? [];
      list.push({ qty, unitPrice, netUnitPrice: round2((unitPrice - discountPerUnit) * creditRate), taxRate: num(l.taxRate) });
      map.set(itemId, list);
    }
    // Dearest first, ties broken deterministically — the server sorts the same way.
    for (const list of map.values())
      list.sort((a, b) => b.netUnitPrice - a.netUnitPrice || b.taxRate - a.taxRate || b.unitPrice - a.unitPrice);
    return map;
  };

  const catalogItems = catalog ?? [];
  const replacementRows = Object.entries(replacements).filter(([, q]) => q > 0);

  /** Exactly the lines exchangeInvoice will post, and therefore exactly what gets charged. */
  const quoteReplacements = () => {
    const pool = buildAllowances();
    const priced: { itemId: string; name: string; quantity: number; rate: number; total: number; asSold: boolean }[] = [];
    let subtotal = 0;
    let tax = 0;
    for (const [itemId, wanted] of replacementRows) {
      const it = catalogItems.find((c) => c.id === itemId);
      let left = round3(wanted);
      for (const a of pool.get(itemId) ?? []) {
        if (left <= 0) break;
        const take = Math.min(left, a.qty);
        if (take <= 0) continue;
        a.qty = round3(a.qty - take);
        left = round3(left - take);
        const taxable = a.unitPrice * take - round2((a.unitPrice - a.netUnitPrice) * take);
        subtotal += taxable;
        tax += (taxable * a.taxRate) / 100;
        priced.push({ itemId, name: it?.name ?? 'Item', quantity: take, rate: a.netUnitPrice, total: taxable * (1 + a.taxRate / 100), asSold: true });
      }
      if (left > 0 && it) {
        const rate = num(it.salePrice);
        const taxable = rate * left;
        subtotal += taxable;
        tax += (taxable * num(it.taxRate)) / 100;
        priced.push({ itemId, name: it.name, quantity: left, rate, total: taxable * (1 + num(it.taxRate) / 100), asSold: false });
      }
    }
    return { priced, newTotal: round2(subtotal + tax) };
  };
  const { priced, newTotal } = quoteReplacements();
  const diff = round2(newTotal - refundValue);

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
        body: JSON.stringify({ mode: 'REFUND', returns: rows, clientId }),
      }),
    onSuccess: () => { toast.success(`Return processed — ${money(refundValue)} refunded`); onDone?.('REFUND'); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Return failed'),
  });

  const exchange = useMutation({
    mutationFn: () =>
      api(`/sale/invoices/${invoiceId}/exchange`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          returns: rows,
          replacements: replacementRows.map(([itemId, quantity]) => ({ itemId, quantity })),
          clientId,
        }),
      }),
    onSuccess: () => { toast.success('Exchange complete — items swapped'); onDone?.('EXCHANGE'); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Exchange failed'),
  });

  const busy = refund.isPending || exchange.isPending;
  const totalUnits = rows.reduce((s, r) => s + r.quantity, 0);
  const filtered = search ? catalogItems.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())) : catalogItems.slice(0, 30);
  const stockOf = (it: CatalogItem) =>
    it.trackStock === false || it.itemType === 'SERVICE' || it.currentStock == null ? null : num(it.currentStock);

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
                const alreadyReturned = alreadyOf(l);
                return (
                  <div key={l.id} className={`flex items-center gap-3 p-2 rounded-lg border ${remaining === 0 ? 'opacity-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {/* What the customer actually paid per unit: this line's own price and
                            discount, and its share of the bill discount, charges and round-off.
                            Multiply by the quantity and you get the refund shown below. */}
                        {purchased} {l.unit} · paid {money(lineValue(l, 1) * billRate)} each
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
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{totalUnits} unit(s) selected · inventory is restored automatically</span>
                <span className="text-base font-bold tabular-nums">{money(refundValue)}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={!rows.length || busy} onClick={() => setStep('replace')}>
                  Exchange →
                </Button>
                <Button className="flex-1" disabled={!rows.length || busy} onClick={() => refund.mutate()}>
                  Refund {money(refundValue)}
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
              {priced.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Replacements</p>
                  {/* One row per PRICED block, so a swap that is part allowance and part new sale
                      shows both rates — the same split the replacement bill will print. */}
                  {priced.map((p, i) => (
                    <div key={`${p.itemId}-${i}`} className="flex items-center gap-2 text-sm py-1">
                      <span className="flex-1 truncate">
                        {p.name}
                        <span className="block text-[10px] text-muted-foreground">
                          {p.quantity} × {money(p.rate)} {p.asSold ? '(credited at the rate you paid)' : '(current price)'}
                        </span>
                      </span>
                      <span className="w-24 text-right tabular-nums">{money(p.total)}</span>
                    </div>
                  ))}
                  {replacementRows.map(([itemId, qty]) => (
                    <div key={`edit-${itemId}`} className="flex items-center gap-2 text-xs py-1">
                      <span className="flex-1 truncate text-muted-foreground">
                        {catalogItems.find((c) => c.id === itemId)?.name ?? 'Item'}
                      </span>
                      <input
                        type="number" min={0} className="w-16 h-8 rounded border px-2 text-right text-sm"
                        value={qty}
                        onChange={(e) => setReplacements((r) => ({ ...r, [itemId]: Math.max(0, Math.floor(Number(e.target.value))) }))}
                      />
                    </div>
                  ))}
                </div>
              )}
              {!catalog && <p className="text-center text-muted-foreground">Loading catalog…</p>}
              {filtered.map((it) => {
                const stock = stockOf(it);
                const allowance = buildAllowances().get(it.id)?.[0];
                return (
                  <button
                    key={it.id}
                    type="button"
                    disabled={stock != null && stock <= 0}
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-lg border hover:bg-accent text-left disabled:opacity-40"
                    onClick={() => setReplacements((r) => ({ ...r, [it.id]: (r[it.id] ?? 0) + 1 }))}
                  >
                    <span className="text-sm truncate">
                      {it.name}
                      {/* The exchange fails as a whole if the replacement is out of stock, so show
                          it here rather than letting the cashier find out from a toast. */}
                      {stock != null && (
                        <span className={`block text-[10px] ${stock <= 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {stock <= 0 ? 'out of stock' : `${stock} in stock`}
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-medium shrink-0 text-right tabular-nums">
                      {money(allowance ? allowance.netUnitPrice : num(it.salePrice))}
                      {allowance && (
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          {allowance.qty} at the rate you paid
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="p-4 border-t space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Credit for returned items {money(refundValue)}</span>
                <span>New items {money(newTotal)}</span>
              </div>
              <p className="text-sm font-semibold">
                {diff >= 0 ? `Customer pays ${money(diff)}` : `Refund customer ${money(-diff)}`}
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
