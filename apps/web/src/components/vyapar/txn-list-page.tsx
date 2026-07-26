'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, RefreshCcw, Eye, FileOutput } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { VyaparStatCard } from '@/components/vyapar/stat-card';
import { PrintButton } from '@/components/vyapar/txn-form';
import { ReturnDialog } from '@/components/pos/return-dialog';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney, TXN_META, TXN_STATUS_LABELS, Txn, TxnType } from '@/lib/txn-meta';

interface ListResponse {
  data: Txn[];
  meta: { page: number; limit: number; total: number };
  summary: { totalAmount: number; totalBalance: number; totalPaid: number };
}

export function TxnListPage({ txnType }: { txnType: TxnType }) {
  const meta = TXN_META[txnType];
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewTxn, setViewTxn] = useState<Txn | null>(null);
  const [returnForId, setReturnForId] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);

  const { data, isLoading } = useQuery({
    queryKey: ['txns', txnType, search, from, to],
    queryFn: () => api<ListResponse>(`${meta.listEndpoint}${meta.listEndpoint.includes('?') ? '&' : '?'}${qs.toString()}`, { token }),
    enabled: !!token,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/txns/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { toast.success(`${meta.label} deleted`); queryClient.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: (t: Txn) => {
      const payments = (t.payments ?? [])
        .filter((p) => p.paymentType !== 'DEBT')
        .map((p) => ({ paymentType: p.paymentType, bankAccountId: p.bankAccountId ?? undefined, amount: Number(p.amount) }));
      return api(meta.convertEndpoint!(t.id), { method: 'POST', token, body: JSON.stringify({ payments }) });
    },
    onSuccess: () => { toast.success('Converted successfully'); queryClient.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const txns = data?.data ?? [];

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <VyaparPageHeader
        title={meta.labelPlural}
        subtitle={`${data?.meta.total ?? 0} transactions`}
        action={
          <Button className="bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)]" onClick={() => router.push(`${meta.listPath}/new`)}>
            <Plus className="h-4 w-4 mr-1" /> Add {meta.label}
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <VyaparStatCard label="Total Amount" value={formatMoney(data?.summary.totalAmount ?? 0)} />
        <VyaparStatCard label={meta.paymentLabel} value={formatMoney(data?.summary.totalPaid ?? 0)} color="border-l-green-500" />
        <VyaparStatCard label="Balance" value={formatMoney(data?.summary.totalBalance ?? 0)} color="border-l-amber-500" />
      </div>

      <div className="bg-white rounded-lg border shadow-sm">
        <div className="p-3 border-b flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search number or party…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-xs text-muted-foreground border-b bg-slate-50">
              <th className="px-3 py-2 text-left">DATE</th>
              <th className="px-3 py-2 text-left">NUMBER</th>
              <th className="px-3 py-2 text-left">PARTY</th>
              <th className="px-3 py-2 text-right">TOTAL</th>
              <th className="px-3 py-2 text-right">{meta.paymentLabel.toUpperCase()}</th>
              <th className="px-3 py-2 text-right">BALANCE</th>
              <th className="px-3 py-2 text-center">STATUS</th>
              <th className="px-3 py-2 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && txns.length === 0 && (
              <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">
                No {meta.labelPlural.toLowerCase()} yet. <Link className="text-red-600 underline" href={`${meta.listPath}/new`}>Create one</Link>
              </td></tr>
            )}
            {txns.map((t) => {
              const status = TXN_STATUS_LABELS[t.status] ?? { label: t.status, className: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={t.id} className="border-b last:border-0 hover:bg-red-50/40">
                  <td className="px-3 py-2">{formatDate(t.date)}</td>
                  <td className="px-3 py-2 font-medium">{t.txnNumber}</td>
                  <td className="px-3 py-2">{t.partyName ?? t.party?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(t.total)}</td>
                  <td className="px-3 py-2 text-right text-green-700">{formatMoney(t.paidAmount)}</td>
                  <td className="px-3 py-2 text-right text-red-600">{formatMoney(t.balance)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', status.className)}>{status.label}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setViewTxn(t)}><Eye className="h-4 w-4" /></Button>
                      <PrintButton txnId={t.id} />
                      {meta.convertEndpoint && ['ORDER_OPEN', 'OPEN'].includes(t.status) && (
                        <Button
                          variant="outline" size="sm" title={meta.convertLabel}
                          disabled={convertMutation.isPending}
                          onClick={() => convertMutation.mutate(t)}
                        >
                          <FileOutput className="h-4 w-4" />
                        </Button>
                      )}
                      {txnType === 'SALE_INVOICE' && t.status !== 'REFUNDED' && (
                        <Button
                          variant="ghost" size="sm" className="gap-1 text-amber-600" title="Return specific items (creates a credit note)"
                          onClick={() => setReturnForId(t.id)}
                        >
                          <RefreshCcw className="h-4 w-4" /> Return
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm" className="text-muted-foreground hover:text-red-600"
                        onClick={() => { if (confirm(`Delete ${t.txnNumber}? Effects will be reversed.`)) deleteMutation.mutate(t.id); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <TxnViewDialog txn={viewTxn} onClose={() => setViewTxn(null)} />

      {returnForId && (
        <ReturnDialog
          invoiceId={returnForId}
          token={token}
          onClose={() => setReturnForId(null)}
          onDone={() => queryClient.invalidateQueries()}
        />
      )}
    </div>
  );
}

export function TxnViewDialog({ txn, onClose }: { txn: Txn | null; onClose: () => void }) {
  if (!txn) return null;
  const meta = TXN_META[txn.txnType];
  return (
    <Dialog open={!!txn} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{meta?.label ?? txn.txnType} — {txn.txnNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Party:</span> {txn.partyName ?? '—'}</div>
            <div><span className="text-muted-foreground">Date:</span> {formatDate(txn.date)}</div>
            <div><span className="text-muted-foreground">Status:</span> {TXN_STATUS_LABELS[txn.status]?.label ?? txn.status}</div>
            {txn.description && <div className="col-span-2"><span className="text-muted-foreground">Notes:</span> {txn.description}</div>}
          </div>
          {!!txn.lines?.length && (
            <table className="w-full text-xs border rounded">
              <thead><tr className="bg-slate-50 text-muted-foreground">
                <th className="px-2 py-1 text-left">Item</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-right">Tax</th>
                <th className="px-2 py-1 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {txn.lines.map((l, i) => (
                  <tr key={l.id ?? i} className="border-t">
                    <td className="px-2 py-1">{l.name}</td>
                    <td className="px-2 py-1 text-right">{Number(l.quantity)} {l.unit}</td>
                    <td className="px-2 py-1 text-right">{formatMoney(l.unitPrice)}</td>
                    <td className="px-2 py-1 text-right">{Number(l.taxRate)}%</td>
                    <td className="px-2 py-1 text-right">{formatMoney(l.total ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="border-t pt-2 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatMoney(txn.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{formatMoney(txn.taxAmount)}</span></div>
            {Number(txn.discountAmount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{formatMoney(txn.discountAmount)}</span></div>}
            <div className="flex justify-between font-bold text-base"><span>Total</span><span>{formatMoney(txn.total)}</span></div>
            <div className="flex justify-between text-green-700"><span>Paid</span><span>{formatMoney(txn.paidAmount)}</span></div>
            <div className="flex justify-between text-red-600"><span>Balance</span><span>{formatMoney(txn.balance)}</span></div>
          </div>
          {!!txn.payments?.length && (
            <div className="text-xs text-muted-foreground">
              Payments: {txn.payments.map((p) => `${p.paymentType} ${formatMoney(p.amount)}`).join(', ')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
