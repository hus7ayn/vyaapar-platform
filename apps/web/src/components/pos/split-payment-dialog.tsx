'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePosStore, SplitPayment } from '@/stores/pos-store';
import { formatCurrency } from '@/lib/utils';

interface SplitPaymentDialogProps {
  total: number;
  onConfirm: (payments: SplitPayment[]) => void;
  onClose: () => void;
}

export function SplitPaymentDialog({ total, onConfirm, onClose }: SplitPaymentDialogProps) {
  const [payments, setPayments] = useState<SplitPayment[]>([
    { method: 'CASH', amount: 0 },
    { method: 'UPI', amount: 0 },
  ]);

  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - paid;

  const update = (index: number, amount: number) => {
    setPayments(payments.map((p, i) => (i === index ? { ...p, amount } : p)));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="text-lg font-bold mb-4">Split Payment</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Total: {formatCurrency(total)} · Remaining: {formatCurrency(remaining)}
        </p>
        {payments.map((p, i) => (
          <div key={p.method} className="flex items-center gap-3 mb-3">
            <span className="w-16 text-sm font-medium">{p.method}</span>
            <Input
              type="number"
              value={p.amount || ''}
              onChange={(e) => update(i, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
        <div className="flex gap-2 mt-6">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={Math.abs(remaining) > 0.01}
            onClick={() => onConfirm(payments.filter((p) => p.amount > 0))}
          >
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
