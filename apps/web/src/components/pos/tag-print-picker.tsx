'use client';

import { useState } from 'react';
import { Barcode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { printBarcodeTags } from '@/lib/print-tags';
import type { CartItem } from '@/stores/pos-store';

/** Optional post-checkout action: print price/barcode tags for items from the bill just saved. */
export function TagPrintPicker({ items, token }: { items: CartItem[]; token?: string }) {
  const taggable = items.filter((i) => !!i.barcode);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(taggable.map((i) => [i.itemId, true])),
  );
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(taggable.map((i) => [i.itemId, i.quantity])),
  );
  const [printing, setPrinting] = useState(false);

  if (!taggable.length) return null;

  const printSelected = async () => {
    const toPrint = taggable.filter((i) => selected[i.itemId]);
    if (!toPrint.length) return;
    setPrinting(true);
    try {
      const tags = await Promise.all(
        toPrint.map(async (i) => {
          const { dataUrl } = await api<{ dataUrl: string }>(
            `/items/barcode-image?text=${encodeURIComponent(i.barcode!)}`,
            { token },
          );
          return { dataUrl, barcode: i.barcode!, name: i.name, price: i.unitPrice, qty: qty[i.itemId] ?? 1 };
        }),
      );
      printBarcodeTags(tags);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-2 p-4 border rounded-xl bg-secondary/30">
      <p className="text-sm font-semibold">Print Tags (optional)</p>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {taggable.map((i) => (
          <div key={i.itemId} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!selected[i.itemId]}
              onChange={(e) => setSelected((s) => ({ ...s, [i.itemId]: e.target.checked }))}
              className="shrink-0"
            />
            <span className="flex-1 truncate">{i.name}</span>
            <Input
              type="number"
              min={1}
              max={200}
              value={qty[i.itemId] ?? 1}
              onChange={(e) => setQty((q) => ({ ...q, [i.itemId]: Number(e.target.value) }))}
              className="w-16 h-7 text-xs shrink-0"
            />
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" disabled={printing} onClick={printSelected}>
        <Barcode className="h-3.5 w-3.5 mr-1" /> Print Selected Tags
      </Button>
    </div>
  );
}
