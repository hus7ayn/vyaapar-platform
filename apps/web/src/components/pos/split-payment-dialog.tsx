'use client';

import { useEffect, useRef, useState } from 'react';
import { Banknote, Smartphone, CreditCard, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SplitPayment } from '@/stores/pos-store';

interface SplitPaymentDialogProps {
  total: number;
  initial?: SplitPayment[];
  onConfirm: (payments: SplitPayment[]) => void;
  onClose: () => void;
}

const METHODS = [
  { method: 'CASH', label: 'Cash', icon: Banknote },
  { method: 'UPI', label: 'UPI', icon: Smartphone },
  { method: 'CARD', label: 'Card', icon: CreditCard },
  { method: 'BANK', label: 'Bank', icon: Landmark },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
// The POS's formatCurrency drops the paise (maximumFractionDigits: 0), which is what made this
// dialog unusable: a ₹0.40 shortfall rendered as "Remaining ₹0" while Confirm stayed greyed out
// with no explanation. Split amounts are always shown to the paisa.
const money = (n: number) => `₹${round2(n).toFixed(2)}`;
// Strip the binary-float tail before an amount is sent. (235.9882 − 200) evaluates to
// 35.988200000000006 in JS; the API re-reads every amount as an exact decimal, so that tail would
// make the payments add up to a hair MORE than the bill and the sale would be rejected outright
// with "Paid amount exceeds total". 12 significant digits keeps every realistic bill to the paisa.
const exact = (n: number) => Number(n.toPrecision(12));
// A cashier can only tender whole paise. Anything inside half a paisa of the bill is "square".
const PAISA = 0.005;

export function SplitPaymentDialog({ total, initial, onConfirm, onClose }: SplitPaymentDialogProps) {
  const [payments, setPayments] = useState<SplitPayment[]>(() =>
    METHODS.map(({ method }) => ({
      method,
      amount: initial?.find((p) => p.method === method)?.amount ?? 0,
    })),
  );
  const firstInputRef = useRef<HTMLInputElement>(null);

  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  // Raw, NOT rounded to paise. With Round Off switched off the bill total keeps its sub-paisa tail
  // (₹199.99 at 18% GST is ₹235.9882), so no set of typed amounts can ever land on it exactly and
  // a strict comparison would leave Confirm greyed out forever. The residue is handled in confirm().
  const remaining = total - paid;
  const balanced = paid > 0 && Math.abs(remaining) < PAISA;

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  // Owns Escape while it is open (the POS page's global shortcuts are suppressed for it), so the
  // dialog can always be dismissed instead of trapping the cashier behind a disabled Confirm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (index: number, amount: number) =>
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, amount: Math.max(0, round2(amount)) } : p)));

  /** Drop the whole outstanding balance onto one tender — one tap always squares the split off. */
  const fillRest = (index: number) =>
    setPayments((prev) => {
      const others = prev.reduce((s, p, i) => (i === index ? s : s + p.amount), 0);
      return prev.map((p, i) => (i === index ? { ...p, amount: Math.max(0, round2(total - others)) } : p));
    });

  const confirm = () => {
    const rows = payments.filter((p) => p.amount > 0).map((p) => ({ ...p, amount: round2(p.amount) }));
    if (!rows.length) return;
    // Square the split off against the bill total EXACTLY by giving the whole residue to the
    // largest tender. The API rejects paidAmount > total outright, and books paidAmount < total
    // silently as a PARTIAL bill with a phantom receivable — "close enough" is not an option.
    //
    // This must survive Round Off being OFF, which is where it used to break: the drift was itself
    // rounded to paise first, so a sub-paisa residue rounded to 0, nothing was absorbed, and the
    // typed ₹235.99 went to the server against a ₹235.9882 bill -> hard 400. Rebuild the largest
    // tender from the total instead of nudging it by a rounded delta, so the sum is the total.
    let big = 0;
    rows.forEach((p, i) => { if (p.amount > rows[big].amount) big = i; });
    const others = rows.reduce((s, p, i) => (i === big ? s : s + p.amount), 0);
    rows[big] = { ...rows[big], amount: Math.max(0, exact(total - exact(others))) };
    onConfirm(rows);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Split Payment</h3>
        <p className="text-sm text-muted-foreground mb-4">Split this bill across two or more tenders.</p>

        <div className="rounded-lg border bg-muted/30 px-3 py-2 mb-4 text-sm space-y-0.5">
          <div className="flex justify-between"><span className="text-muted-foreground">Bill total</span><span className="font-semibold">{money(total)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Entered</span><span>{money(paid)}</span></div>
          <div className={`flex justify-between font-bold ${balanced ? 'text-emerald-700' : 'text-[hsl(348,85%,52%)]'}`}>
            <span>{!balanced && remaining < 0 ? 'Over by' : 'Remaining'}</span>
            <span>{money(Math.abs(balanced ? 0 : remaining))}</span>
          </div>
        </div>

        {payments.map((p, i) => {
          const Icon = METHODS[i].icon;
          return (
            <div key={p.method} className="flex items-center gap-2 mb-2">
              <span className="w-24 shrink-0 text-sm font-medium flex items-center gap-1.5">
                <Icon className="h-4 w-4 text-muted-foreground" /> {METHODS[i].label}
              </span>
              <Input
                ref={i === 0 ? firstInputRef : undefined}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                placeholder="0.00"
                value={p.amount || ''}
                onChange={(e) => update(i, parseFloat(e.target.value) || 0)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 text-xs"
                disabled={balanced}
                onClick={() => fillRest(i)}
              >
                Rest
              </Button>
            </div>
          );
        })}

        {!balanced && (
          <p className="text-xs text-muted-foreground mt-3">
            {remaining > 0
              ? `Enter ${money(remaining)} more (or tap Rest) to enable Confirm.`
              : `Remove ${money(-remaining)} — the split cannot exceed the bill total.`}
          </p>
        )}

        <div className="flex gap-2 mt-5">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1 font-bold" disabled={!balanced} onClick={confirm}>
            Confirm split
          </Button>
        </div>
      </div>
    </div>
  );
}
