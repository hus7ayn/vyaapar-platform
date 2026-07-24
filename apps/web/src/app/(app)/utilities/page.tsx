'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileDown, RefreshCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
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

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

type ImportType = 'parties' | 'items';

// Columns accepted by the backend import (see PartyInput / ItemInput). Numeric
// columns are coerced to numbers before upload (CSV cells are all strings).
const TEMPLATE_COLUMNS: Record<ImportType, string[]> = {
  items: ['name', 'sku', 'barcode', 'hsnCode', 'salePrice', 'costPrice', 'purchasePrice', 'mrp', 'taxRate', 'baseUnit', 'openingStock', 'minStock'],
  parties: ['name', 'phone', 'email', 'gstin', 'gstType', 'state', 'billingAddress', 'partyType', 'creditLimit', 'openingBalance', 'openingBalanceType'],
};

const TEMPLATE_EXAMPLE: Record<ImportType, string[]> = {
  items: ['Basmati Rice 5kg', '', '8901234567890', '1006', '450', '380', '380', '500', '5', 'PCS', '100', '10'],
  parties: ['Sharma Traders', '9876543210', 'sharma@example.com', '', 'UNREGISTERED', 'Maharashtra', 'Shop 4, MG Road', 'CUSTOMER', '0', '0', 'TO_RECEIVE'],
};

const NUMERIC_FIELDS: Record<ImportType, string[]> = {
  items: ['salePrice', 'costPrice', 'purchasePrice', 'wholesalePrice', 'wholesaleMinQty', 'mrp', 'taxRate', 'openingStock', 'minStock', 'conversionRate'],
  parties: ['creditLimit', 'openingBalance'],
};

// Minimal RFC-4180-ish CSV parser: handles quoted fields, "" escapes, CRLF/LF.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
      return obj;
    });
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function UtilitiesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [importType, setImportType] = useState<ImportType>('parties');
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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
    const url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/exports/${type}?format=${exportFormat}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${type}.${exportFormat}`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => toast.error('Export failed'));
  };

  const downloadTemplate = () => {
    const cols = TEMPLATE_COLUMNS[importType];
    const csv = [cols.join(','), TEMPLATE_EXAMPLE[importType].map(csvCell).join(',')].join('\n');
    downloadBlob(csv, `${importType}-template.csv`, 'text/csv');
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('[');
      let rows: Record<string, unknown>[];
      if (isJson) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('JSON file must contain an array of records');
        rows = parsed;
      } else {
        const numeric = NUMERIC_FIELDS[importType];
        rows = parseCsv(text).map((o) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(o)) {
            if (v === '') continue; // leave blank cells unset
            out[k] = numeric.includes(k) ? Number(v) : v;
          }
          return out;
        });
      }
      if (!rows.length) throw new Error('No rows found in the file');
      const endpoint = importType === 'parties' ? '/parties/import' : '/items/import';
      const res = await api<ImportResult>(endpoint, { method: 'POST', token, body: JSON.stringify({ rows }) });
      setImportResult(res);
      qc.invalidateQueries({ queryKey: [importType] });
      if (res.created > 0 && !res.errors.length) {
        toast.success(`Imported ${res.created} ${importType}${res.skipped ? `, ${res.skipped} skipped` : ''}`);
      } else if (res.created > 0) {
        toast.error(`Imported ${res.created}, but ${res.errors.length} row(s) failed — see details`);
      } else {
        toast.error(`Nothing imported — ${res.skipped} skipped, ${res.errors.length} failed`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
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
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Format:</span>
          <div className="flex rounded-lg border overflow-hidden">
            {(['xlsx', 'csv'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setExportFormat(f)}
                className={`px-3 py-1 text-xs font-medium ${exportFormat === f ? 'bg-primary text-white' : 'bg-background text-muted-foreground'}`}
              >
                {f === 'xlsx' ? 'Excel' : 'CSV'}
              </button>
            ))}
          </div>
        </div>
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
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-10 rounded-lg border px-3 text-sm" value={importType} onChange={(e) => { setImportType(e.target.value as ImportType); setImportResult(null); }}>
            <option value="parties">Parties</option>
            <option value="items">Items</option>
          </select>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <FileDown className="h-4 w-4 mr-1" /> Download {importType} template (CSV)
          </Button>
        </div>
        <input
          type="file"
          accept=".csv,.json"
          disabled={importing}
          className="text-sm block"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
            e.target.value = '';
          }}
        />
        <p className="text-xs text-muted-foreground">
          Upload a CSV (matching the template above) or a JSON array. Existing records with the same name are skipped.
          {importing && ' Importing…'}
        </p>

        {importResult && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
            <div className="flex flex-wrap gap-4 font-medium">
              <span className="text-emerald-600">Created: {importResult.created}</span>
              <span className="text-amber-600">Skipped (duplicates): {importResult.skipped}</span>
              <span className="text-destructive">Failed: {importResult.errors.length}</span>
            </div>
            {importResult.errors.length > 0 && (
              <ul className="list-disc pl-5 space-y-0.5 text-xs text-destructive max-h-40 overflow-y-auto">
                {importResult.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
