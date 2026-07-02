'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VyaparStatCard } from '@/components/vyapar/stat-card';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney, TXN_META, TXN_STATUS_LABELS, TxnType } from '@/lib/txn-meta';

type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
type GstType = 'UNREGISTERED' | 'REGISTERED' | 'COMPOSITION' | 'CONSUMER';

interface Party {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  gstType: GstType;
  state?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  partyType: PartyType;
  creditLimit?: string | number | null;
  openingBalance: string | number;
  openingBalanceType: 'TO_RECEIVE' | 'TO_PAY';
  currentBalance: string;
  loyaltyPoints: number;
  group?: { id: string; name: string } | null;
}

interface PartiesSummary {
  totalReceivable: number;
  totalPayable: number;
  partyCount: number;
}

interface PartyTxn {
  id: string;
  txnType: TxnType;
  txnNumber: string;
  date: string;
  total: string | number;
  paidAmount: string | number;
  balance: string | number;
  status: string;
}

interface LedgerResponse {
  party: { id: string; name: string; currentBalance: string };
  openingBalance: string | number;
  entries: {
    id: string;
    entryType: string;
    amount: string;
    balance: string | number;
    description?: string | null;
    entryDate: string;
    txn?: { id: string; txnType: TxnType; txnNumber: string; total: string | number } | null;
  }[];
}

interface PartyForm {
  name: string;
  phone: string;
  email: string;
  gstin: string;
  gstType: GstType;
  state: string;
  billingAddress: string;
  partyType: PartyType;
  creditLimit: string;
  openingBalance: string;
  openingBalanceType: 'TO_RECEIVE' | 'TO_PAY';
}

const EMPTY_FORM: PartyForm = {
  name: '',
  phone: '',
  email: '',
  gstin: '',
  gstType: 'UNREGISTERED',
  state: '',
  billingAddress: '',
  partyType: 'CUSTOMER',
  creditLimit: '',
  openingBalance: '',
  openingBalanceType: 'TO_RECEIVE',
};

const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  CUSTOMER: 'Customer',
  SUPPLIER: 'Supplier',
  BOTH: 'Customer & Supplier',
};

const GST_TYPES: { value: GstType; label: string }[] = [
  { value: 'UNREGISTERED', label: 'Unregistered' },
  { value: 'REGISTERED', label: 'Registered' },
  { value: 'COMPOSITION', label: 'Composition' },
  { value: 'CONSUMER', label: 'Consumer' },
];

function BalanceText({ balance, className }: { balance: string | number; className?: string }) {
  const n = Number(balance);
  if (n > 0) {
    return (
      <span className={cn('text-green-700 inline-flex items-center gap-0.5', className)}>
        {formatMoney(n)} <ArrowDownLeft className="h-3 w-3" />
      </span>
    );
  }
  if (n < 0) {
    return (
      <span className={cn('text-red-600 inline-flex items-center gap-0.5', className)}>
        {formatMoney(Math.abs(n))} <ArrowUpRight className="h-3 w-3" />
      </span>
    );
  }
  return <span className={cn('text-muted-foreground', className)}>{formatMoney(0)}</span>;
}

export default function PartiesPage() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CUSTOMER' | 'SUPPLIER'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'transactions' | 'ledger'>('transactions');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [form, setForm] = useState<PartyForm>(EMPTY_FORM);

  const listQs = new URLSearchParams();
  if (search) listQs.set('search', search);
  if (typeFilter !== 'ALL') listQs.set('type', typeFilter);

  const { data: parties, isLoading } = useQuery({
    queryKey: ['parties', search, typeFilter],
    queryFn: () => api<Party[]>(`/parties?${listQs.toString()}`, { token }),
    enabled: !!token,
  });

  const { data: summary } = useQuery({
    queryKey: ['parties-summary'],
    queryFn: () => api<PartiesSummary>('/parties/summary', { token }),
    enabled: !!token,
  });

  const { data: selected } = useQuery({
    queryKey: ['party', selectedId],
    queryFn: () => api<Party>(`/parties/${selectedId}`, { token }),
    enabled: !!token && !!selectedId,
  });

  const { data: partyTxns, isLoading: txnsLoading } = useQuery({
    queryKey: ['party-txns', selectedId],
    queryFn: () => api<PartyTxn[]>(`/parties/${selectedId}/transactions`, { token }),
    enabled: !!token && !!selectedId && detailTab === 'transactions',
  });

  const ledgerQs = new URLSearchParams();
  if (ledgerFrom) ledgerQs.set('from', ledgerFrom);
  if (ledgerTo) ledgerQs.set('to', ledgerTo);

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['party-ledger', selectedId, ledgerFrom, ledgerTo],
    queryFn: () => api<LedgerResponse>(`/parties/${selectedId}/ledger?${ledgerQs.toString()}`, { token }),
    enabled: !!token && !!selectedId && detailTab === 'ledger',
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        phone: form.phone || undefined,
        email: form.email || undefined,
        gstin: form.gstin || undefined,
        gstType: form.gstType,
        state: form.state || undefined,
        billingAddress: form.billingAddress || undefined,
        partyType: form.partyType,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
      };
      if (!editingParty) {
        body.openingBalance = form.openingBalance ? Number(form.openingBalance) : undefined;
        body.openingBalanceType = form.openingBalanceType;
      }
      return editingParty
        ? api(`/parties/${editingParty.id}`, { method: 'PATCH', token, body: JSON.stringify(body) })
        : api('/parties', { method: 'POST', token, body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(editingParty ? 'Party updated' : 'Party created');
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['parties'] });
      queryClient.invalidateQueries({ queryKey: ['parties-summary'] });
      queryClient.invalidateQueries({ queryKey: ['party'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/parties/${id}`, { method: 'DELETE', token }),
    onSuccess: () => {
      toast.success('Party deleted');
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['parties'] });
      queryClient.invalidateQueries({ queryKey: ['parties-summary'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditingParty(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (p: Party) => {
    setEditingParty(p);
    setForm({
      name: p.name,
      phone: p.phone ?? '',
      email: p.email ?? '',
      gstin: p.gstin ?? '',
      gstType: p.gstType,
      state: p.state ?? '',
      billingAddress: p.billingAddress ?? '',
      partyType: p.partyType,
      creditLimit: p.creditLimit != null ? String(p.creditLimit) : '',
      openingBalance: '',
      openingBalanceType: 'TO_RECEIVE',
    });
    setDialogOpen(true);
  };

  const list = parties ?? [];
  const set = (patch: Partial<PartyForm>) => setForm((f) => ({ ...f, ...patch }));
  const fieldCls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="p-4 lg:p-6 flex gap-4 items-start">
      {/* LEFT pane */}
      <div className="w-80 shrink-0 bg-white rounded-lg border shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-bold">Parties</h1>
            <Button size="sm" className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Add Party
            </Button>
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search parties…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {([
              { value: 'ALL', label: 'All' },
              { value: 'CUSTOMER', label: 'Customers' },
              { value: 'SUPPLIER', label: 'Suppliers' },
            ] as const).map((t) => (
              <button
                key={t.value}
                className={cn(
                  'flex-1 text-xs font-medium rounded-md py-1.5 transition-colors',
                  typeFilter === t.value ? 'bg-[hsl(348,85%,52%)] text-white' : 'bg-slate-100 text-muted-foreground hover:bg-slate-200',
                )}
                onClick={() => setTypeFilter(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading && <p className="text-center py-8 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && list.length === 0 && (
            <p className="text-center py-8 text-sm text-muted-foreground">No parties found</p>
          )}
          {list.map((p) => (
            <button
              key={p.id}
              className={cn(
                'w-full text-left px-3 py-2.5 border-b last:border-0 flex items-center justify-between gap-2 hover:bg-red-50/40 transition-colors',
                selectedId === p.id && 'bg-red-50',
              )}
              onClick={() => { setSelectedId(p.id); setDetailTab('transactions'); }}
            >
              <span className="font-medium text-sm truncate">{p.name}</span>
              <BalanceText balance={p.currentBalance} className="text-xs font-semibold shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT pane */}
      <div className="flex-1 min-w-0 space-y-4">
        {!selectedId && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <VyaparStatCard label="To Receive" value={formatMoney(summary?.totalReceivable ?? 0)} color="border-l-green-500" icon={<ArrowDownLeft className="h-4 w-4 text-green-600" />} />
              <VyaparStatCard label="To Pay" value={formatMoney(summary?.totalPayable ?? 0)} color="border-l-red-500" icon={<ArrowUpRight className="h-4 w-4 text-red-600" />} />
              <VyaparStatCard label="Total Parties" value={String(summary?.partyCount ?? 0)} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
            </div>
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className="p-3 border-b">
                <p className="font-semibold text-sm">All Parties</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b bg-slate-50">
                    <th className="px-3 py-2 text-left">NAME</th>
                    <th className="px-3 py-2 text-left">PHONE</th>
                    <th className="px-3 py-2 text-left">GSTIN</th>
                    <th className="px-3 py-2 text-left">TYPE</th>
                    <th className="px-3 py-2 text-right">BALANCE</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
                  )}
                  {!isLoading && list.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">No parties yet. Add your first party to get started.</td></tr>
                  )}
                  {list.map((p) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-red-50/40 cursor-pointer" onClick={() => setSelectedId(p.id)}>
                      <td className="px-3 py-2 font-medium">{p.name}</td>
                      <td className="px-3 py-2">{p.phone ?? '—'}</td>
                      <td className="px-3 py-2">{p.gstin ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                          {PARTY_TYPE_LABELS[p.partyType]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-medium"><BalanceText balance={p.currentBalance} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {selectedId && selected && (
          <>
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">{selected.name}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                      {PARTY_TYPE_LABELS[selected.partyType]}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-0.5">
                    {selected.phone && <p>📞 {selected.phone}</p>}
                    {selected.gstin && <p>GSTIN: {selected.gstin}</p>}
                    {selected.billingAddress && <p>{selected.billingAddress}</p>}
                  </div>
                </div>
                <div className="text-right space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{Number(selected.currentBalance) >= 0 ? 'To Receive' : 'To Pay'}</p>
                    <p className={cn('text-2xl font-bold', Number(selected.currentBalance) > 0 ? 'text-green-700' : Number(selected.currentBalance) < 0 ? 'text-red-600' : '')}>
                      {formatMoney(Math.abs(Number(selected.currentBalance)))}
                    </p>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => openEdit(selected)}>
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="outline" size="sm" className="text-red-600 hover:text-red-700"
                      disabled={deleteMutation.isPending}
                      onClick={() => { if (confirm(`Delete ${selected.name}?`)) deleteMutation.mutate(selected.id); }}
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className="border-b flex">
                {([
                  { value: 'transactions', label: 'Transactions' },
                  { value: 'ledger', label: 'Ledger Statement' },
                ] as const).map((t) => (
                  <button
                    key={t.value}
                    className={cn(
                      'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                      detailTab === t.value
                        ? 'border-[hsl(348,85%,52%)] text-[hsl(348,85%,52%)]'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setDetailTab(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {detailTab === 'transactions' && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b bg-slate-50">
                      <th className="px-3 py-2 text-left">DATE</th>
                      <th className="px-3 py-2 text-left">TYPE</th>
                      <th className="px-3 py-2 text-left">NUMBER</th>
                      <th className="px-3 py-2 text-right">TOTAL</th>
                      <th className="px-3 py-2 text-right">BALANCE</th>
                      <th className="px-3 py-2 text-center">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txnsLoading && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                    )}
                    {!txnsLoading && !(partyTxns ?? []).length && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No transactions with this party yet</td></tr>
                    )}
                    {(partyTxns ?? []).map((t) => {
                      const meta = TXN_META[t.txnType];
                      const status = TXN_STATUS_LABELS[t.status] ?? { label: t.status, className: 'bg-gray-100 text-gray-600' };
                      return (
                        <tr key={t.id} className="border-b last:border-0 hover:bg-red-50/40">
                          <td className="px-3 py-2">{formatDate(t.date)}</td>
                          <td className="px-3 py-2">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', meta?.color ?? 'bg-gray-50 text-gray-600')}>
                              {meta?.label ?? t.txnType}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium">{t.txnNumber}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatMoney(t.total)}</td>
                          <td className="px-3 py-2 text-right text-red-600">{formatMoney(t.balance)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', status.className)}>{status.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {detailTab === 'ledger' && (
                <div>
                  <div className="p-3 border-b flex items-center gap-2">
                    <Input type="date" className="w-40" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input type="date" className="w-40" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} />
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b bg-slate-50">
                        <th className="px-3 py-2 text-left">DATE</th>
                        <th className="px-3 py-2 text-left">DESCRIPTION</th>
                        <th className="px-3 py-2 text-left">TYPE</th>
                        <th className="px-3 py-2 text-right">AMOUNT</th>
                        <th className="px-3 py-2 text-right">BALANCE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerLoading && (
                        <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                      )}
                      {!ledgerLoading && ledger && (
                        <tr className="border-b bg-slate-50/50">
                          <td className="px-3 py-2 text-muted-foreground" colSpan={4}>Opening Balance</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatMoney(ledger.openingBalance)}</td>
                        </tr>
                      )}
                      {!ledgerLoading && ledger && ledger.entries.length === 0 && (
                        <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No ledger entries in this period</td></tr>
                      )}
                      {(ledger?.entries ?? []).map((e) => {
                        const amt = Number(e.amount);
                        return (
                          <tr key={e.id} className="border-b last:border-0 hover:bg-red-50/40">
                            <td className="px-3 py-2">{formatDate(e.entryDate)}</td>
                            <td className="px-3 py-2">{e.description ?? (e.txn ? `${TXN_META[e.txn.txnType]?.label ?? e.txn.txnType} ${e.txn.txnNumber}` : '—')}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">{e.entryType}</td>
                            <td className={cn('px-3 py-2 text-right font-medium', amt >= 0 ? 'text-green-700' : 'text-red-600')}>
                              {amt >= 0 ? '+' : '-'}{formatMoney(Math.abs(amt))}
                            </td>
                            <td className="px-3 py-2 text-right">{formatMoney(e.balance)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editingParty ? `Edit ${editingParty.name}` : 'Add Party'}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim()) { toast.error('Party name is required'); return; }
              saveMutation.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Party Name *</label>
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Sharma Traders" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="Mobile number" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="Email" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">GSTIN</label>
                <Input value={form.gstin} onChange={(e) => set({ gstin: e.target.value })} placeholder="GSTIN" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">GST Type</label>
                <select className={fieldCls} value={form.gstType} onChange={(e) => set({ gstType: e.target.value as GstType })}>
                  {GST_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">State</label>
                <Input value={form.state} onChange={(e) => set({ state: e.target.value })} placeholder="State" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Party Type</label>
                <select className={fieldCls} value={form.partyType} onChange={(e) => set({ partyType: e.target.value as PartyType })}>
                  <option value="CUSTOMER">Customer</option>
                  <option value="SUPPLIER">Supplier</option>
                  <option value="BOTH">Both</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Billing Address</label>
                <Input value={form.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} placeholder="Billing address" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Credit Limit</label>
                <Input type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => set({ creditLimit: e.target.value })} placeholder="No limit" />
              </div>
              {!editingParty && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Opening Balance</label>
                  <div className="flex gap-2">
                    <Input type="number" min="0" step="0.01" value={form.openingBalance} onChange={(e) => set({ openingBalance: e.target.value })} placeholder="0.00" />
                    <div className="flex rounded-lg border overflow-hidden shrink-0">
                      {([
                        { value: 'TO_RECEIVE', label: 'To Receive' },
                        { value: 'TO_PAY', label: 'To Pay' },
                      ] as const).map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          className={cn(
                            'px-2 text-xs font-medium transition-colors',
                            form.openingBalanceType === o.value
                              ? o.value === 'TO_RECEIVE' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                              : 'bg-background text-muted-foreground hover:bg-accent',
                          )}
                          onClick={() => set({ openingBalanceType: o.value })}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : editingParty ? 'Save Changes' : 'Create Party'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
