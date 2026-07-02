'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { formatDate, formatMoney } from '@/lib/txn-meta';
import { cn } from '@/lib/utils';

interface Cheque {
  id: string;
  chequeNumber: string;
  amount: string | number;
  chequeDate: string;
  status: 'OPEN' | 'SETTLED' | 'BOUNCED';
  direction: 'RECEIVED' | 'PAID';
  partyName?: string | null;
  bankName?: string | null;
}

interface BankAccount {
  id: string;
  name: string;
}

export default function ChequesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');

  const { data: cheques } = useQuery({
    queryKey: ['cheques', statusFilter],
    queryFn: () => api<Cheque[]>(`/cash-bank/cheques?status=${statusFilter}`, { token }),
  });

  const { data: accounts } = useQuery({
    queryKey: ['cash-bank-accounts'],
    queryFn: () => api<BankAccount[]>('/cash-bank/accounts', { token }),
  });

  const settle = useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string }) =>
      api(`/cash-bank/cheques/${id}/settle`, {
        method: 'POST',
        token,
        body: JSON.stringify({ accountId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cheques'] });
      qc.invalidateQueries({ queryKey: ['cash-bank-summary'] });
      toast.success('Cheque settled');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: (id: string) => api(`/cash-bank/cheques/${id}/reopen`, { method: 'POST', token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cheques'] });
      toast.success('Cheque reopened');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const defaultAccountId = accounts?.[0]?.id;

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <VyaparPageHeader
        title="Cheques"
        subtitle="Track received and paid cheques"
        action={
          <Link href="/cash-bank">
            <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          </Link>
        }
      />

      <div className="flex gap-2">
        {['OPEN', 'SETTLED', 'BOUNCED'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium',
              statusFilter === s ? 'bg-[hsl(348,85%,52%)] text-white' : 'bg-muted',
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3">Cheque #</th>
              <th className="text-left p-3">Party</th>
              <th className="text-left p-3">Direction</th>
              <th className="text-left p-3">Date</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(cheques ?? []).map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3 font-medium">{c.chequeNumber}</td>
                <td className="p-3">{c.partyName ?? '-'}</td>
                <td className="p-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', c.direction === 'RECEIVED' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700')}>
                    {c.direction}
                  </span>
                </td>
                <td className="p-3">{formatDate(c.chequeDate)}</td>
                <td className="p-3 text-right font-semibold">{formatMoney(c.amount)}</td>
                <td className="p-3 text-right">
                  {c.status === 'OPEN' && defaultAccountId && (
                    <Button size="sm" variant="outline" onClick={() => settle.mutate({ id: c.id, accountId: defaultAccountId })}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Settle
                    </Button>
                  )}
                  {c.status === 'SETTLED' && (
                    <Button size="sm" variant="ghost" onClick={() => reopen.mutate(c.id)}>Reopen</Button>
                  )}
                </td>
              </tr>
            ))}
            {!cheques?.length && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No cheques found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
