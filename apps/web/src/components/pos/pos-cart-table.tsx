'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePosStore, CartItem } from '@/stores/pos-store';
import { formatCurrency } from '@/lib/utils';

export function PosLineEditDialog({
  item,
  open,
  onClose,
}: {
  item: CartItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const updateQuantity = usePosStore((s) => s.updateQuantity);
  const updatePrice = usePosStore((s) => s.updatePrice);
  const updateLineDiscount = usePosStore((s) => s.updateLineDiscount);
  const getLineTotal = usePosStore((s) => s.getLineTotal);

  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [disc, setDisc] = useState(0);

  useEffect(() => {
    if (item && open) {
      setQty(item.quantity);
      setPrice(item.unitPrice);
      setDisc(item.discount);
    }
  }, [item, open]);

  const draft: CartItem | null = item ? { ...item, quantity: qty, unitPrice: price, discount: disc } : null;

  const save = () => {
    if (!item) return;
    updateQuantity(item.itemId, qty);
    updatePrice(item.itemId, price);
    updateLineDiscount(item.itemId, disc);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{item?.name}</DialogTitle>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Quantity</label>
                <Input type="number" min={0.001} step="any" value={qty} onChange={(e) => setQty(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Rate (₹)</label>
                <Input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Line Discount (₹)</label>
              <Input type="number" min={0} value={disc} onChange={(e) => setDisc(parseFloat(e.target.value) || 0)} />
            </div>
            {item.hsnCode && <p className="text-xs text-muted-foreground">HSN: {item.hsnCode} · GST {item.taxRate}%</p>}
            <div className="flex justify-between font-bold text-[hsl(348,85%,52%)]">
              <span>Line Total</span>
              <span>{draft ? formatCurrency(getLineTotal(draft)) : '—'}</span>
            </div>
            <Button className="w-full bg-[hsl(348,85%,52%)]" onClick={save}>Update Line</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PosCartTable({ onEditLine }: { onEditLine: (item: CartItem) => void }) {
  const cart = usePosStore((s) => s.cart);
  const updateQuantity = usePosStore((s) => s.updateQuantity);
  const removeItem = usePosStore((s) => s.removeItem);
  const getLineTotal = usePosStore((s) => s.getLineTotal);
  const getTotalQty = usePosStore((s) => s.getTotalQty);

  if (!cart.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
        Scan barcode or tap items to add to bill
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs">
          <thead className="bg-[hsl(348,30%,96%)] sticky top-0 z-10">
            <tr className="text-left text-muted-foreground">
              <th className="p-2 font-semibold w-8">#</th>
              <th className="p-2 font-semibold">Item</th>
              <th className="p-2 font-semibold w-16 text-center">Qty</th>
              <th className="p-2 font-semibold w-20 text-right">Rate</th>
              <th className="p-2 font-semibold w-20 text-right">Amount</th>
              <th className="p-2 w-14" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {cart.map((item, idx) => (
              <tr key={item.itemId} className="hover:bg-muted/30 group">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2">
                  <p className="font-medium leading-tight">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.unit ?? 'PCS'}
                    {item.discount > 0 && ` · Disc ${formatCurrency(item.discount)}`}
                  </p>
                </td>
                <td className="p-2">
                  <div className="flex items-center justify-center gap-0.5">
                    <button type="button" className="h-6 w-6 rounded border text-xs hover:bg-muted" onClick={() => updateQuantity(item.itemId, item.quantity - 1)}>−</button>
                    <span className="w-8 text-center font-semibold">{item.quantity}</span>
                    <button type="button" className="h-6 w-6 rounded border text-xs hover:bg-muted" onClick={() => updateQuantity(item.itemId, item.quantity + 1)}>+</button>
                  </div>
                </td>
                <td className="p-2 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="p-2 text-right font-semibold">{formatCurrency(getLineTotal(item))}</td>
                <td className="p-2">
                  <div className="flex gap-1 opacity-60 group-hover:opacity-100">
                    <button type="button" onClick={() => onEditLine(item)} className="text-muted-foreground hover:text-foreground">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => removeItem(item.itemId)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 border-t bg-muted/20 text-[10px] text-muted-foreground flex justify-between">
        <span>{cart.length} item(s)</span>
        <span>Total Qty: {getTotalQty()}</span>
      </div>
    </div>
  );
}
