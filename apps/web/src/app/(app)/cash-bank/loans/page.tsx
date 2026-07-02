'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { formatMoney } from '@/lib/txn-meta';

interface LoanAccount {
  id: string;
  name: string;
  lenderName?: string | null;
  principalAmount: string | number;
  currentBalance: string | number;
  interestRate?: string | number | null;
  loanType: string;
}

export default function LoansPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    lenderName: '',
    principalAmount: 0,
    interestRate: 0,
    loanType: 'TAKEN',
  });

  const { data: loans } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api<LoanAccount[]>('/cash-bank/loans', { token }),
  });

  const createLoan = useMutation({
    mutationFn: () =>
      api('/cash-bank/loans', {
        method: 'POST',
        token,
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['cash-bank-summary'] });
      toast.success('Loan account created');
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <VyaparPageHeader
        title="Loan Accounts"
        subtitle="Track loans taken and given"
        action={
          <div className="flex gap-2">
            <Link href="/cash-bank">
              <Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
            </Link>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Loan
            </Button>
          </div>
        }
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(loans ?? []).map((loan) => (
          <div key={loan.id} className="p-4 rounded-xl border bg-card">
            <p className="text-xs text-muted-foreground uppercase">{loan.loanType}</p>
            <p className="font-semibold mt-1">{loan.name}</p>
            {loan.lenderName && <p className="text-xs text-muted-foreground">{loan.lenderName}</p>}
            <p className="text-lg font-bold text-[hsl(348,85%,52%)] mt-2">{formatMoney(loan.currentBalance)}</p>
            <p className="text-xs text-muted-foreground mt-1">Principal: {formatMoney(loan.principalAmount)}</p>
          </div>
        ))}
        {!loans?.length && (
          <p className="col-span-full text-center text-muted-foreground py-12">No loan accounts yet</p>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Loan Account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Loan name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Lender name" value={form.lenderName} onChange={(e) => setForm({ ...form, lenderName: e.target.value })} />
            <select className="w-full h-10 rounded-lg border px-3" value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })}>
              <option value="TAKEN">Loan Taken</option>
              <option value="GIVEN">Loan Given</option>
            </select>
            <Input type="number" placeholder="Principal amount" value={form.principalAmount || ''} onChange={(e) => setForm({ ...form, principalAmount: parseFloat(e.target.value) || 0 })} />
            <Input type="number" placeholder="Interest rate %" value={form.interestRate || ''} onChange={(e) => setForm({ ...form, interestRate: parseFloat(e.target.value) || 0 })} />
            <Button onClick={() => createLoan.mutate()} disabled={!form.name.trim()}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
