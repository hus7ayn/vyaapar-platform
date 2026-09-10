'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Landmark, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { VyaparStatCard } from '@/components/vyapar/stat-card';
import { formatDate, formatMoney } from '@/lib/txn-meta';
import { cn } from '@/lib/utils';

interface BankAccount {
  id: string;
  name: string;
  accountType: 'CASH' | 'BANK' | 'UPI' | 'CARD';
  accountNumber?: string | null;
  bankName?: string | null;
  balance: string | number;
}

interface Summary {
  cashBalance: number;
  bankBalance: number;
  upiBalance: number;
  cardBalance: number;
  totalBalance: number;
  totalReceivable: number;
  totalPayable: number;
  openChequesReceived: number;
  openChequesPaid: number;
  loanBalance: number;
  accounts: BankAccount[];
}

interface Transfer {
  id: string;
  amount: string | number;
  date: string;
  transferType: string;
  description?: string | null;
  from?: { id: string; name: string } | null;
  to?: { id: string; name: string } | null;
}

interface StatementEntry {
  date: string;
  type: string;
  ref?: string;
  party?: string | null;
  amount: number;
}

export default function CashBankPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const branchId = useAuthStore((s) => s.activeShopId) ?? undefined;
  const qc = useQueryClient();
  const [tab, setTab] = useState<'accounts' | 'transfers' | 'statement'>('accounts');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [accountForm, setAccountForm] = useState({
    name: '',
    accountType: 'BANK',
    accountNumber: '',
    bankName: '',
    openingBalance: 0,
  });
  const [transferForm, setTransferForm] = useState({
    fromAccountId: '',
    toAccountId: '',
    amount: 0,
    description: '',
    date: new Date().toISOString().slice(0, 10),
  });

  const { data: summary } = useQuery({
    queryKey: ['cash-bank-summary', branchId],
    queryFn: () => api<Summary>('/cash-bank/summary', { token, branchId }),
  });

  const { data: transfers } = useQuery({
    queryKey: ['cash-bank-transfers', branchId],
    queryFn: () => api<Transfer[]>('/cash-bank/transfers', { token, branchId }),
    enabled: tab === 'transfers',
  });

  const { data: statement } = useQuery({
    queryKey: ['cash-bank-statement', selectedAccountId, branchId],
    queryFn: () => api<{ account: BankAccount; entries: StatementEntry[] }>(`/cash-bank/accounts/${selectedAccountId}/statement`, { token, branchId }),
    enabled: tab === 'statement' && !!selectedAccountId,
  });

  const createAccount = useMutation({
    mutationFn: () =>
      api('/cash-bank/accounts', {
        method: 'POST',
        token,
        body: JSON.stringify(accountForm),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-bank-summary'] });
      toast.success('Account created');
      setShowAccountForm(false);
      setAccountForm({ name: '', accountType: 'BANK', accountNumber: '', bankName: '', openingBalance: 0 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createTransfer = useMutation({
    mutationFn: () =>
      api('/cash-bank/transfers', {
        method: 'POST',
        token,
        branchId,
        body: JSON.stringify({
          transferType: 'BANK_TO_BANK',
          fromAccountId: transferForm.fromAccountId,
          toAccountId: transferForm.toAccountId,
          amount: transferForm.amount,
          date: transferForm.date,
          description: transferForm.description || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-bank-summary'] });
      qc.invalidateQueries({ queryKey: ['cash-bank-transfers'] });
      toast.success('Transfer recorded');
      setShowTransferForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const accounts = summary?.accounts ?? [];

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <VyaparPageHeader
        title="Cash & Bank"
        subtitle="Accounts, transfers and statements"
        action={
          <div className="flex gap-2 flex-wrap">
            <Link href="/cash-bank/cheques">
              <Button variant="outline" size="sm">Cheques</Button>
            </Link>
            <Link href="/cash-bank/loans">
              <Button variant="outline" size="sm">Loans</Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <VyaparStatCard label="Cash in Hand" value={formatMoney(summary?.cashBalance ?? 0)} icon={<Wallet className="h-4 w-4 text-muted-foreground" />} />
        <VyaparStatCard label="Bank" value={formatMoney(summary?.bankBalance ?? 0)} icon={<Landmark className="h-4 w-4 text-muted-foreground" />} />
        <VyaparStatCard label="UPI" value={formatMoney(summary?.upiBalance ?? 0)} icon={<Landmark className="h-4 w-4 text-muted-foreground" />} />
        <VyaparStatCard label="Card" value={formatMoney(summary?.cardBalance ?? 0)} icon={<Landmark className="h-4 w-4 text-muted-foreground" />} />
        <VyaparStatCard label="Total Balance" value={formatMoney(summary?.totalBalance ?? 0)} icon={<Landmark className="h-4 w-4 text-muted-foreground" />} />
        <VyaparStatCard label="Loan Outstanding" value={formatMoney(summary?.loanBalance ?? 0)} icon={<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />} />
      </div>

      <div className="flex gap-2 border-b overflow-x-auto">
        {(['accounts', 'transfers', 'statement'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize',
              tab === t ? 'border-[hsl(348,85%,52%)] text-[hsl(348,85%,52%)]' : 'border-transparent text-muted-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'accounts' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowAccountForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Account
            </Button>
          </div>
          {(['CASH', 'BANK', 'UPI', 'CARD'] as const).map((type) => {
            const group = accounts.filter((a) => a.accountType === type);
            if (!group.length) return null;
            const label = { CASH: 'Cash', BANK: 'Bank', UPI: 'UPI', CARD: 'Card' }[type];
            return (
              <div key={type} className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">{label}</p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => { setSelectedAccountId(a.id); setTab('statement'); }}
                      className="text-left p-4 rounded-xl border bg-card hover:border-[hsl(348,85%,52%)] transition-colors"
                    >
                      <p className="text-xs text-muted-foreground uppercase">{a.accountType}</p>
                      <p className="font-semibold mt-1">{a.name}</p>
                      {a.bankName && <p className="text-xs text-muted-foreground">{a.bankName}</p>}
                      <p className="text-lg font-bold text-[hsl(348,85%,52%)] mt-2">{formatMoney(a.balance)}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {!accounts.length && <p className="text-sm text-muted-foreground">No accounts yet.</p>}
        </div>
      )}

      {tab === 'transfers' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowTransferForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Transfer
            </Button>
          </div>
          <div className="rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">From</th>
                  <th className="text-left p-3">To</th>
                  <th className="text-right p-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(transfers ?? []).map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-3">{formatDate(t.date)}</td>
                    <td className="p-3">{t.from?.name ?? '—'}</td>
                    <td className="p-3">{t.to?.name ?? '—'}</td>
                    <td className="p-3 text-right font-medium">{formatMoney(t.amount)}</td>
                  </tr>
                ))}
                {!transfers?.length && (
                  <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No transfers yet</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'statement' && (
        <div className="space-y-3">
          <select
            className="h-10 rounded-lg border px-3 text-sm bg-background"
            value={selectedAccountId ?? ''}
            onChange={(e) => setSelectedAccountId(e.target.value || null)}
          >
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.accountType})</option>
            ))}
          </select>
          {statement && (
            <div className="rounded-xl border overflow-hidden">
              <div className="p-3 bg-muted/30 border-b">
                <p className="font-semibold">{statement.account.name}</p>
                <p className="text-sm text-muted-foreground">Balance: {formatMoney(statement.account.balance)}</p>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Description</th>
                    <th className="text-right p-3">Debit</th>
                    <th className="text-right p-3">Credit</th>
                    <th className="text-right p-3">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.entries.map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-3">{formatDate(e.date)}</td>
                      <td className="p-3">{e.party ?? e.ref ?? e.type}</td>
                      <td className="p-3 text-right">{e.amount < 0 ? formatMoney(Math.abs(e.amount)) : '—'}</td>
                      <td className="p-3 text-right">{e.amount >= 0 ? formatMoney(e.amount) : '—'}</td>
                      <td className="p-3 text-right font-medium">{formatMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={showAccountForm} onOpenChange={setShowAccountForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Bank / Cash Account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Account name" value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} />
            <select className="w-full h-10 rounded-lg border px-3" value={accountForm.accountType} onChange={(e) => setAccountForm({ ...accountForm, accountType: e.target.value })}>
              <option value="BANK">Bank</option>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
            </select>
            <Input placeholder="Bank name" value={accountForm.bankName} onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })} />
            <Input placeholder="Account number" value={accountForm.accountNumber} onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })} />
            <Input type="number" placeholder="Opening balance" value={accountForm.openingBalance || ''} onChange={(e) => setAccountForm({ ...accountForm, openingBalance: parseFloat(e.target.value) || 0 })} />
            <Button onClick={() => createAccount.mutate()} disabled={!accountForm.name.trim()}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTransferForm} onOpenChange={setShowTransferForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bank Transfer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <select className="w-full h-10 rounded-lg border px-3" value={transferForm.fromAccountId} onChange={(e) => setTransferForm({ ...transferForm, fromAccountId: e.target.value })}>
              <option value="">From account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="w-full h-10 rounded-lg border px-3" value={transferForm.toAccountId} onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })}>
              <option value="">To account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <Input type="number" placeholder="Amount" value={transferForm.amount || ''} onChange={(e) => setTransferForm({ ...transferForm, amount: parseFloat(e.target.value) || 0 })} />
            <Input type="date" value={transferForm.date} onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })} />
            <Input placeholder="Description" value={transferForm.description} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} />
            <Button onClick={() => createTransfer.mutate()} disabled={!transferForm.fromAccountId || !transferForm.toAccountId || transferForm.amount <= 0}>Transfer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
