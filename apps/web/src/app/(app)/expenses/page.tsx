'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { VyaparStatCard } from '@/components/vyapar/stat-card';
import { formatDate, formatMoney, TXN_STATUS_LABELS, Txn } from '@/lib/txn-meta';
import { cn } from '@/lib/utils';

interface ListResponse {
  data: Txn[];
  summary: { totalAmount: number; totalPaid: number };
}

export default function ExpensesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api<ListResponse>('/expenses?limit=100', { token }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/txns/${id}`, { method: 'DELETE', token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const expenses = data?.data ?? [];

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <VyaparPageHeader
        title="Expenses"
        subtitle="Track business expenses"
        action={
          <Link href="/expenses/new">
            <Button className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]">
              <Plus className="h-4 w-4 mr-2" /> Add Expense
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 max-w-md">
        <VyaparStatCard label="Total Expenses" value={formatMoney(data?.summary?.totalAmount ?? 0)} />
        <VyaparStatCard label="Paid" value={formatMoney(data?.summary?.totalPaid ?? 0)} />
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3">#</th>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Description</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {expenses.map((e) => {
              const st = TXN_STATUS_LABELS[e.status] ?? { label: e.status, className: 'bg-gray-100' };
              return (
                <tr key={e.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => router.push(`/expenses/new?edit=${e.id}`)}>
                  <td className="p-3 font-medium">{e.txnNumber}</td>
                  <td className="p-3">{formatDate(e.date)}</td>
                  <td className="p-3 text-muted-foreground truncate max-w-[200px]">{e.description ?? '—'}</td>
                  <td className="p-3 text-right font-semibold">{formatMoney(e.total)}</td>
                  <td className="p-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', st.className)}>{st.label}</span>
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={(ev) => { ev.stopPropagation(); deleteMutation.mutate(e.id); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !expenses.length && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No expenses recorded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
