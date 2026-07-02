'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { formatDate, formatMoney, TXN_META, Txn } from '@/lib/txn-meta';

interface VerifyResult {
  issues: { type: string; message: string; entityId?: string }[];
  fixed?: number;
}

interface ListResponse {
  data: Txn[];
}

export default function UtilitiesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [importType, setImportType] = useState<'parties' | 'items'>('parties');

  const { data: recycleBin } = useQuery({
    queryKey: ['recycle-bin'],
    queryFn: () => api<ListResponse>('/txns/recycle-bin?limit=50', { token }),
  });

  const verify = useMutation({
    mutationFn: (fix: boolean) =>
      api<VerifyResult>(`/utilities/verify-data${fix ? '?fix=true' : ''}`, { method: 'POST', token }),
    onSuccess: (res) => {
      toast.success(res.issues.length ? `Found ${res.issues.length} issues${res.fixed ? `, fixed ${res.fixed}` : ''}` : 'Data verified — no issues');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restore = useMutation({
    mutationFn: (id: string) => api(`/txns/${id}/restore`, { method: 'POST', token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recycle-bin'] });
      toast.success('Transaction restored');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadExport = (type: string) => {
    const url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/exports/${type}?format=xlsx`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${type}.xlsx`;
        a.click();
      });
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const rows = JSON.parse(text);
      const endpoint = importType === 'parties' ? '/parties/import' : '/items/import';
      await api(endpoint, { method: 'POST', token, body: JSON.stringify({ rows }) });
      toast.success(`${importType} imported successfully`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed — use JSON array format');
    }
  };

  const deleted = recycleBin?.data ?? [];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl">
      <VyaparPageHeader title="Utilities" subtitle="Verify data, recycle bin, import & export" />

      <section className="p-4 rounded-xl border space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Verify Data</h2>
        <p className="text-sm text-muted-foreground">Check stock, party balances and ledger consistency</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => verify.mutate(false)} disabled={verify.isPending}>Run Check</Button>
          <Button onClick={() => verify.mutate(true)} disabled={verify.isPending}>Check & Fix</Button>
        </div>
      </section>

      <section className="p-4 rounded-xl border space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Trash2 className="h-5 w-5" /> Recycle Bin</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Date</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-right p-2" />
              </tr>
            </thead>
            <tbody>
              {deleted.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">{t.txnNumber}</td>
                  <td className="p-2">{TXN_META[t.txnType]?.label ?? t.txnType}</td>
                  <td className="p-2">{formatDate(t.date)}</td>
                  <td className="p-2 text-right">{formatMoney(t.total)}</td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => restore.mutate(t.id)}>
                      <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Restore
                    </Button>
                  </td>
                </tr>
              ))}
              {!deleted.length && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Recycle bin is empty</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="p-4 rounded-xl border space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Download className="h-5 w-5" /> Export</h2>
        <div className="flex flex-wrap gap-2">
          {['parties', 'items', 'expenses', 'inventory'].map((t) => (
            <Button key={t} variant="outline" size="sm" onClick={() => downloadExport(t)}>
              <Download className="h-4 w-4 mr-1" /> {t}
            </Button>
          ))}
        </div>
      </section>

      <section className="p-4 rounded-xl border space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Upload className="h-5 w-5" /> Import</h2>
        <select className="h-10 rounded-lg border px-3 text-sm" value={importType} onChange={(e) => setImportType(e.target.value as 'parties' | 'items')}>
          <option value="parties">Parties (JSON)</option>
          <option value="items">Items (JSON)</option>
        </select>
        <input
          type="file"
          accept=".json"
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
          }}
        />
        <p className="text-xs text-muted-foreground">Upload a JSON array matching the import schema</p>
      </section>
    </div>
  );
}
