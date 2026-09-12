'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency, cn } from '@/lib/utils';
import { usePosStore } from '@/stores/pos-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Txn } from '@/lib/txn-meta';

/** Quick-resume chips kept on the bar. Anything past this lives behind the "Held" button. */
const INLINE_CHIPS = 2;

export function HeldOrdersPanel({ branchId }: { branchId?: string }) {
  const token = useAuthStore((s) => s.accessToken)!;
  const loadFromHeld = usePosStore((s) => s.loadFromHeld);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['held-invoices', branchId],
    queryFn: () => {
      const qs = branchId ? `?branchId=${branchId}` : '';
      return api<{ data: Txn[] }>(`/sale/invoices/held${qs}`, { token });
    },
    refetchInterval: 15000,
  });

  const held = data?.data ?? [];

  const resume = async (txn: Txn) => {
    if (!txn.lines?.length) {
      toast.error('Held bill has no items');
      return;
    }
    loadFromHeld(
      txn.lines.map((l) => ({
        itemId: l.itemId ?? l.id ?? '',
        name: l.name,
        sku: '',
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discount: Number(l.discountAmount ?? 0),
        taxRate: Number(l.taxRate ?? 0),
      })).filter((i) => i.itemId),
      // Hand the store the bill's money fields as the API stored them, NOT a bare rupee figure.
      // The API's discountAmount is tax-inclusive; the store needs subtotal and tax to convert it
      // back to the ₹-off-the-subtotal discount the POS works in, otherwise every hold/resume
      // cycle inflates the discount by the tax factor and the bill gets cheaper each time.
      {
        discountAmount: Number(txn.discountAmount ?? 0),
        subtotal: Number(txn.subtotal ?? 0),
        taxAmount: Number(txn.taxAmount ?? 0),
      },
      txn.id,
    );
    setOpen(false);
    toast.success(`Loaded ${txn.txnNumber}`);
  };

  if (!held.length) return null;

  const inline = held.slice(0, INLINE_CHIPS);
  const overflow = held.length - inline.length;

  // Rendered inside the red POS top bar, which sets `text-white` on everything below it. The
  // default `outline` button only paints a (near-white) background and inherits its text colour,
  // so these chips used to be white-on-white — present, clickable, but invisible. Paint both the
  // background AND the text explicitly.
  //
  // The strip itself used to be width-capped (26rem desktop / 38vw mobile) and scrolled with a
  // `scrollbar-hide` class that no plugin in this project defines — so there was no scrollbar and
  // no hint, and any bill past the cap was simply unreachable (on a phone 38vw is narrower than
  // ONE chip, so the very first hold vanished). Now the bar carries at most a couple of chips as
  // a fast path and the "Held" button ALWAYS states the true count and opens the full list, so no
  // parked bill can hide off the edge of the screen.
  const chip = (order: Txn) => (
    <Button
      key={order.id}
      variant="secondary"
      size="sm"
      className="shrink-0 gap-1 h-9 bg-white/95 text-[hsl(348,85%,52%)] hover:bg-white font-semibold"
      onClick={() => resume(order)}
    >
      <Clock className="h-3.5 w-3.5" />
      {order.txnNumber} · {formatCurrency(Number(order.total))}
    </Button>
  );

  return (
    <>
      <div className="hidden md:flex items-center gap-1.5">{inline.map(chip)}</div>

      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(
          'shrink-0 gap-1.5 h-9 bg-white/95 text-[hsl(348,85%,52%)] hover:bg-white font-semibold',
          // On a wide screen every held bill is already a chip when nothing overflows, so the
          // button would just be noise. On a narrow screen the chips are hidden and it is the
          // ONLY way in, so it always shows there.
          overflow === 0 && 'md:hidden',
        )}
        title="Show every held bill"
      >
        <Clock className="h-4 w-4" /> Held
        <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(348,85%,52%)] px-1.5 text-[10px] font-bold text-white">
          {held.length}
        </span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold">Held Bills ({held.length})</h3>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {held.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 p-3 rounded-lg border">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{o.txnNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {o.partyName ?? 'Walk-in'} · {Number(o.lines?.length ?? 0)} item(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold">{formatCurrency(Number(o.total))}</span>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => resume(o)}>
                      <Clock className="h-3.5 w-3.5" /> Resume
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
