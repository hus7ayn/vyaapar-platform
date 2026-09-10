'use client';

import { useEffect, useState } from 'react';
import {
  Banknote, Smartphone, CreditCard, Clock, Landmark, Split, Printer, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePosStore } from '@/stores/pos-store';
import { formatCurrency, cn } from '@/lib/utils';
import { PermissionGate } from '@/components/permission-gate';
import { Permission } from '@nexus/shared';

const PAYMENT_METHODS = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'UPI', label: 'UPI', icon: Smartphone },
  { id: 'CARD', label: 'Card', icon: CreditCard },
  { id: 'BANK', label: 'Bank', icon: Landmark },
  { id: 'DEBT', label: 'Credit', icon: Clock },
] as const;

type PaymentId = (typeof PAYMENT_METHODS)[number]['id'];

interface Props {
  paymentMethod: PaymentId;
  onPaymentMethod: (m: PaymentId) => void;
  onSplit: () => void;
  onSave: (print?: boolean) => void;
  onHold: () => void;
  onClear: () => void;
  isPending: boolean;
  hasCart: boolean;
  /** Active split tender, if any — while set it replaces the single Payment Mode above. */
  splitPayments: { method: string; amount: number }[];
  onClearSplit: () => void;
}

export function PosBillFooter({
  paymentMethod,
  onPaymentMethod,
  onSplit,
  onSave,
  onHold,
  onClear,
  isPending,
  hasCart,
  splitPayments,
  onClearSplit,
}: Props) {
  const getSubtotal = usePosStore((s) => s.getSubtotal);
  const getTaxableAmount = usePosStore((s) => s.getTaxableAmount);
  const getCgst = usePosStore((s) => s.getCgst);
  const getSgst = usePosStore((s) => s.getSgst);
  const getTax = usePosStore((s) => s.getTax);
  const getRoundOffAmount = usePosStore((s) => s.getRoundOffAmount);
  const getTotal = usePosStore((s) => s.getTotal);
  const discountAmount = usePosStore((s) => s.discountAmount);
  const discountPercent = usePosStore((s) => s.discountPercent);
  const secondaryDiscountAmount = usePosStore((s) => s.secondaryDiscountAmount);
  const setDiscountPercent = usePosStore((s) => s.setDiscountPercent);
  const setSecondaryDiscountAmount = usePosStore((s) => s.setSecondaryDiscountAmount);
  const removeTax = usePosStore((s) => s.removeTax);
  const setRemoveTax = usePosStore((s) => s.setRemoveTax);
  const roundOff = usePosStore((s) => s.roundOff);
  const setRoundOff = usePosStore((s) => s.setRoundOff);
  const additionalCharges = usePosStore((s) => s.additionalCharges);
  const setAdditionalCharges = usePosStore((s) => s.setAdditionalCharges);
  const pointsRedeemed = usePosStore((s) => s.pointsRedeemed);

  const roundAmt = getRoundOffAmount();
  const tax = getTax();

  // ONE bill discount at a time. The store still keeps the two values apart (percent vs flat ₹)
  // because that is what the API takes, but the UI only ever exposes a single field plus a unit
  // toggle, and switching the unit zeroes the other value — so a % and a ₹ discount can never
  // both be folded into discountAmount (which is what used to double-discount a bill).
  // Whichever value actually carries a discount decides the unit shown (a resumed held bill, for
  // instance, always comes back as a flat ₹ amount); the local preference only matters at zero.
  const [preferredMode, setPreferredMode] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const discountMode: 'PERCENT' | 'AMOUNT' =
    discountPercent > 0 ? 'PERCENT' : secondaryDiscountAmount > 0 ? 'AMOUNT' : preferredMode;

  // Self-heal a cart persisted before the two fields became exclusive: both could be non-zero at
  // once and the store added them together. Keep the percentage and drop the stranded flat amount.
  useEffect(() => {
    if (discountPercent > 0 && secondaryDiscountAmount > 0) setSecondaryDiscountAmount(0);
  }, [discountPercent, secondaryDiscountAmount, setSecondaryDiscountAmount]);

  const switchDiscountMode = (mode: 'PERCENT' | 'AMOUNT') => {
    if (mode === discountMode) return;
    // Clear BOTH before switching: whichever value was typed under the old unit is meaningless
    // under the new one, and leaving it behind is exactly how both discounts used to apply.
    setDiscountPercent(0);
    setSecondaryDiscountAmount(0);
    setPreferredMode(mode);
  };

  const onDiscountInput = (raw: string) => {
    const value = Math.max(0, parseFloat(raw) || 0);
    if (discountMode === 'PERCENT') {
      setSecondaryDiscountAmount(0);
      setDiscountPercent(Math.min(100, value));
    } else {
      setDiscountPercent(0);
      // A flat discount can never exceed the goods value, otherwise the bill total goes negative.
      setSecondaryDiscountAmount(Math.min(getSubtotal(), value));
    }
  };

  const discountValue = discountMode === 'PERCENT' ? discountPercent : secondaryDiscountAmount;
  const splitTotal = splitPayments.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="border-t bg-white shrink-0">
      <div className="px-3 py-2 grid grid-cols-3 gap-2 text-[11px]">
        <div className="col-span-2 flex items-center gap-1">
          <span className="text-muted-foreground shrink-0">Discount</span>
          <div className="flex rounded-md border overflow-hidden shrink-0">
            {(['PERCENT', 'AMOUNT'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => switchDiscountMode(mode)}
                className={cn(
                  'h-7 w-7 text-xs font-bold transition-colors',
                  discountMode === mode
                    ? 'bg-[hsl(348,85%,52%)] text-white'
                    : 'bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {mode === 'PERCENT' ? '%' : '₹'}
              </button>
            ))}
          </div>
          <Input
            type="number"
            min={0}
            {...(discountMode === 'PERCENT' ? { max: 100 } : {})}
            className="h-7 text-xs"
            placeholder={discountMode === 'PERCENT' ? '0 %' : '0 ₹'}
            value={discountValue || ''}
            onChange={(e) => onDiscountInput(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground shrink-0">Extra ₹</span>
          <Input type="number" min={0} className="h-7 text-xs" value={additionalCharges || ''} onChange={(e) => setAdditionalCharges(Math.max(0, parseFloat(e.target.value) || 0))} />
        </div>
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-3 text-[11px]">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" className="rounded" checked={removeTax} onChange={(e) => setRemoveTax(e.target.checked)} />
          <span>Tax Exempt</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" className="rounded" checked={roundOff} onChange={(e) => setRoundOff(e.target.checked)} />
          <span>Round Off</span>
        </label>
      </div>

      <div className="px-3 py-2 space-y-0.5 text-xs border-t bg-[hsl(348,30%,98%)]">
        <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(getSubtotal())}</span></div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-emerald-700"><span>Discount</span><span>−{formatCurrency(discountAmount)}</span></div>
        )}
        <div className="flex justify-between"><span className="text-muted-foreground">Taxable</span><span>{formatCurrency(getTaxableAmount())}</span></div>
        {!removeTax && tax > 0 && (
          <>
            <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{formatCurrency(getCgst())}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{formatCurrency(getSgst())}</span></div>
          </>
        )}
        {additionalCharges > 0 && (
          <div className="flex justify-between"><span className="text-muted-foreground">Additional</span><span>{formatCurrency(additionalCharges)}</span></div>
        )}
        {pointsRedeemed > 0 && (
          <div className="flex justify-between text-emerald-700"><span>Points</span><span>−{formatCurrency(pointsRedeemed)}</span></div>
        )}
        {roundOff && Math.abs(roundAmt) > 0.001 && (
          <div className="flex justify-between"><span className="text-muted-foreground">Round Off</span><span>{formatCurrency(roundAmt)}</span></div>
        )}
        <div className="flex justify-between text-base font-bold text-[hsl(348,85%,52%)] pt-1 border-t border-dashed">
          <span>Grand Total</span>
          <span>{formatCurrency(getTotal())}</span>
        </div>
      </div>

      {/* A confirmed split REPLACES the single payment mode — showing both would leave the cashier
          guessing which one the bill will actually use. */}
      {splitPayments.length > 0 ? (
        <div className="px-3 py-2 border-t">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Split Payment</p>
            <button type="button" onClick={onClearSplit} className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-0.5">
              <X className="h-3 w-3" /> Remove
            </button>
          </div>
          <div className="rounded-md border bg-[hsl(348,30%,98%)] px-2 py-1.5 space-y-0.5 text-[11px]">
            {splitPayments.map((p) => (
              <div key={p.method} className="flex justify-between">
                <span className="text-muted-foreground">{p.method}</span>
                <span className="font-semibold">{formatCurrency(p.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-dashed pt-0.5 font-bold text-[hsl(348,85%,52%)]">
              <span>Tendered</span>
              <span>{formatCurrency(splitTotal)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 border-t">
          <p className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Payment Mode</p>
          <div className="grid grid-cols-5 gap-1">
            {PAYMENT_METHODS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onPaymentMethod(id)}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-1.5 rounded-md border text-[9px] font-semibold transition-colors',
                  paymentMethod === id
                    ? 'border-[hsl(348,85%,52%)] bg-[hsl(348,85%,52%)]/10 text-[hsl(348,85%,52%)]'
                    : 'bg-background hover:bg-muted/50',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 grid grid-cols-4 gap-2 border-t bg-muted/10">
        <Button variant="outline" size="sm" className="h-10 text-xs" disabled={!hasCart} onClick={onClear}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" className="h-10 text-xs" disabled={!hasCart || isPending} onClick={onHold}>
          Hold Bill
        </Button>
        <PermissionGate permission={Permission.POS_SELL}>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-10 text-xs', splitPayments.length > 0 && 'border-[hsl(348,85%,52%)] text-[hsl(348,85%,52%)] font-semibold')}
            disabled={!hasCart}
            onClick={onSplit}
          >
            <Split className="h-3.5 w-3.5 mr-1" /> Split
          </Button>
        </PermissionGate>
        <Button
          size="sm"
          className="h-10 text-xs col-span-1 bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)] font-bold"
          disabled={!hasCart || isPending}
          onClick={() => onSave(false)}
        >
          {isPending ? '…' : 'Save'}
        </Button>
      </div>

      <Button
        className="w-full rounded-none h-12 text-sm font-bold bg-[hsl(348,75%,42%)] hover:bg-[hsl(348,75%,36%)]"
        disabled={!hasCart || isPending}
        onClick={() => onSave(true)}
      >
        <Printer className="h-4 w-4 mr-2" />
        Save &amp; Print — {formatCurrency(getTotal())}
      </Button>

      <p className="text-[10px] text-center text-muted-foreground py-1">F2 Search · F12 Save &amp; Print · Esc Clear · Alt+D POS</p>
    </div>
  );
}
