'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { usePosStore } from '@/stores/pos-store';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Txn } from '@/lib/txn-meta';

export function HeldOrdersPanel({ branchId }: { branchId?: string }) {
  const token = useAuthStore((s) => s.accessToken)!;
  const loadFromHeld = usePosStore((s) => s.loadFromHeld);

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
      Number(txn.discountAmount ?? 0),
      txn.id,
    );
    toast.success(`Loaded ${txn.txnNumber}`);
  };

  if (!held.length) return null;

  return (
    <div className="flex gap-2 overflow-x-auto p-2">
      {held.map((order) => (
        <Button
          key={order.id}
          variant="outline"
          size="sm"
          className="shrink-0 gap-1"
          onClick={() => resume(order)}
        >
          <Clock className="h-3.5 w-3.5" />
          {order.txnNumber} · {formatCurrency(Number(order.total))}
        </Button>
      ))}
    </div>
  );
}
