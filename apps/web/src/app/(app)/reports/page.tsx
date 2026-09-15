'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { formatMoney } from '@/lib/txn-meta';
import { cn } from '@/lib/utils';

type ReportDef = {
  id: string;
  label: string;
  category: string;
  endpoint: string;
  needsDate?: boolean;
  needsDateOnly?: boolean;
  exportType?: string;
};

const REPORTS: ReportDef[] = [
  { id: 'dashboard', label: 'Business Dashboard', category: 'Overview', endpoint: '/reports/dashboard' },
  { id: 'sale', label: 'Sale Report', category: 'Transactions', endpoint: '/reports/sale', needsDate: true, exportType: 'sales' },
  { id: 'purchase', label: 'Purchase Report', category: 'Transactions', endpoint: '/reports/purchase', needsDate: true },
  { id: 'day-book', label: 'Day Book', category: 'Transactions', endpoint: '/reports/day-book', needsDateOnly: true },
  { id: 'all-transactions', label: 'All Transactions', category: 'Transactions', endpoint: '/reports/all-transactions', needsDate: true },
  { id: 'cash-flow', label: 'Cash Flow', category: 'Transactions', endpoint: '/reports/cash-flow', needsDate: true },
  { id: 'bill-wise-profit', label: 'Bill-wise Profit', category: 'Transactions', endpoint: '/reports/bill-wise-profit', needsDate: true },
  { id: 'discount', label: 'Discount Report', category: 'Transactions', endpoint: '/reports/discount', needsDate: true },
  { id: 'orders-sale', label: 'Open Sale Orders', category: 'Orders', endpoint: '/reports/orders/sale?status=ORDER_OPEN' },
  { id: 'orders-purchase', label: 'Open Purchase Orders', category: 'Orders', endpoint: '/reports/orders/purchase?status=ORDER_OPEN' },
  { id: 'all-parties', label: 'All Parties', category: 'Parties', endpoint: '/reports/all-parties', exportType: 'parties' },
  { id: 'party-wise-profit', label: 'Party-wise Profit', category: 'Parties', endpoint: '/reports/party-wise-profit', needsDate: true },
  { id: 'sale-purchase-by-party', label: 'Sale/Purchase by Party', category: 'Parties', endpoint: '/reports/sale-purchase-by-party', needsDate: true },
  { id: 'stock-summary', label: 'Stock Summary', category: 'Inventory', endpoint: '/reports/stock-summary', exportType: 'inventory' },
  { id: 'item-wise-profit', label: 'Item-wise Profit', category: 'Inventory', endpoint: '/reports/item-wise-profit', needsDate: true },
  { id: 'low-stock', label: 'Low Stock', category: 'Inventory', endpoint: '/reports/low-stock' },
  { id: 'stock-detail', label: 'Stock Detail', category: 'Inventory', endpoint: '/reports/stock-detail', needsDate: true },
  { id: 'by-category-sale', label: 'Sale by Category', category: 'Inventory', endpoint: '/reports/by-item-category/sale', needsDate: true },
  { id: 'by-category-purchase', label: 'Purchase by Category', category: 'Inventory', endpoint: '/reports/by-item-category/purchase', needsDate: true },
  { id: 'pnl', label: 'Profit & Loss', category: 'Financial', endpoint: '/reports/pnl', needsDate: true },
  { id: 'trial-balance', label: 'Trial Balance', category: 'Financial', endpoint: '/reports/trial-balance' },
  { id: 'balance-sheet', label: 'Balance Sheet', category: 'Financial', endpoint: '/reports/balance-sheet' },
  { id: 'gstr1', label: 'GSTR-1', category: 'GST', endpoint: '/reports/gstr1', needsDate: true, exportType: 'gstr1-json' },
  { id: 'gstr2', label: 'GSTR-2', category: 'GST', endpoint: '/reports/gstr2', needsDate: true },
  { id: 'gstr3b', label: 'GSTR-3B', category: 'GST', endpoint: '/reports/gstr3b', needsDate: true },
  { id: 'hsn-summary', label: 'HSN Summary', category: 'GST', endpoint: '/reports/hsn-summary', needsDate: true },
  { id: 'tax-rate', label: 'Tax Rate Report', category: 'GST', endpoint: '/reports/tax-rate', needsDate: true },
];

const CATEGORIES = [...new Set(REPORTS.map((r) => r.category))];

function buildUrl(def: ReportDef, from: string, to: string, date: string) {
  const base = def.endpoint;
  if (def.needsDateOnly) return `${base}?date=${date}`;
  if (def.needsDate) return `${base}?from=${from}&to=${to}`;
  return base;
}

function renderValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return formatMoney(v);
  if (typeof v === 'string' && !isNaN(Number(v)) && v.includes('.')) return formatMoney(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return `${v.length} rows`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The Profit & Loss payload, on both bases. See apps/api/src/reports/realisation.util.ts. */
type Pnl = {
  grossSales: number; saleReturns: number; netSales: number;
  purchase: number; purchaseReturns: number;
  cogs: number; grossProfit: number; expenses: number; netProfit: number;
  outputTax: number; inputTax: number; outputTaxOnReturns: number; netOutputTax: number;
  realisedRevenue: number; realisedCogs: number; realisedGrossProfit: number; realisedNetProfit: number;
  creditSalesOutstanding: number; unrealisedProfitOnCredit: number; realisedOnPeriodSales: number;
  settlementDiscounts: number; realisedCashCollected: number; realisedOnCheques: number;
  unallocatedReceipts: number; unallocatedReceiptsMatched: number; unallocatedReceiptsUnmatched: number;
};

function isPnl(v: unknown): v is Pnl {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'realisedGrossProfit' in (v as object);
}

function Line({ label, value, hint, strong, negative }: {
  label: string; value: number; hint?: string; strong?: boolean; negative?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', strong && 'border-t mt-1 pt-2')}>
      <div className="min-w-0">
        <p className={cn('text-sm', strong ? 'font-semibold' : 'text-muted-foreground')}>{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <p className={cn('shrink-0 tabular-nums', strong ? 'text-base font-bold' : 'text-sm font-medium', negative && 'text-red-600')}>
        {negative && value > 0 ? '−' : ''}{formatMoney(value)}
      </p>
    </div>
  );
}

/**
 * Profit & Loss on BOTH bases, with the payment-based ("realised") figure as the headline: a
 * product sold on credit is a receivable, not earnings, until the customer actually pays.
 */
function ProfitAndLossView({ d }: { d: Pnl }) {
  return (
    <div className="p-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-green-200 bg-green-50/70 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-green-800">Profit &mdash; money actually received</p>
          <p className="mt-1 text-3xl font-bold text-green-800 tabular-nums">{formatMoney(d.realisedNetProfit)}</p>
          <p className="mt-1 text-xs text-green-900/70">
            Gross {formatMoney(d.realisedGrossProfit)} less expenses {formatMoney(d.expenses)}. A credit sale
            counts only once the customer pays, in the period the money arrives.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">On paper &mdash; includes unpaid bills</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{formatMoney(d.netProfit)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Books every invoice the day it is raised, paid or not. This is the accounting basis your
            GST returns use; it is not the cash in your till.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Profit not yet received</p>
          <p className="mt-1 text-2xl font-bold text-amber-800 tabular-nums">{formatMoney(d.unrealisedProfitOnCredit)}</p>
          <p className="text-[11px] text-amber-900/70">Riding on this period&apos;s credit sales that are still unpaid.</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Credit sales outstanding</p>
          <p className="mt-1 text-2xl font-bold text-amber-800 tabular-nums">{formatMoney(d.creditSalesOutstanding)}</p>
          <p className="text-[11px] text-amber-900/70">Of this period&apos;s bills, still to be collected.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <p className="font-semibold mb-2">Realised (payment basis)</p>
          <Line label="Revenue received" value={d.realisedRevenue} hint="Net of tax, pro rata to each bill paid" />
          <Line label="Cost of goods received for" value={d.realisedCogs} negative />
          {d.settlementDiscounts !== 0 && (
            <Line label="Settlement discounts written off" value={d.settlementDiscounts} hint="Closed the bill without any money arriving" negative />
          )}
          <Line label="Realised gross profit" value={d.realisedGrossProfit} strong />
          <Line label="Expenses" value={d.expenses} negative />
          <Line label="Realised net profit" value={d.realisedNetProfit} strong />
          <div className="mt-3 border-t pt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>Cash collected in this period: <span className="font-semibold text-foreground">{formatMoney(d.realisedCashCollected)}</span>
              {d.realisedOnCheques !== 0 && <> &middot; of which cheques (counted as received, not yet banked): <span className="font-semibold text-foreground">{formatMoney(d.realisedOnCheques)}</span></>}
            </p>
            <p>Of this period&apos;s own sales, profit collected so far: <span className="font-semibold text-foreground">{formatMoney(d.realisedOnPeriodSales)}</span> &mdash; this is what the bill-wise, item-wise and party-wise profit reports total.</p>
            {d.unallocatedReceipts > 0 && (
              <p>
                Receipts that named no bill: <span className="font-semibold text-foreground">{formatMoney(d.unallocatedReceipts)}</span>
                {' '}(matched to open bills {formatMoney(d.unallocatedReceiptsMatched)}
                {d.unallocatedReceiptsUnmatched > 0 && <>, unmatched {formatMoney(d.unallocatedReceiptsUnmatched)}</>})
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <p className="font-semibold mb-2">On paper (accrual basis)</p>
          <Line label="Gross sales" value={d.grossSales} />
          <Line label="Sale returns" value={d.saleReturns} negative />
          <Line label="Net sales" value={d.netSales} strong />
          <Line label="Output tax (net of returns)" value={d.netOutputTax} hint={`Charged ${formatMoney(d.outputTax)}, returned ${formatMoney(d.outputTaxOnReturns)}`} negative />
          <Line label="Cost of goods sold" value={d.cogs} negative />
          <Line label="Gross profit" value={d.grossProfit} strong />
          <Line label="Expenses" value={d.expenses} negative />
          <Line label="Net profit" value={d.netProfit} strong />
          <div className="mt-3 border-t pt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>Purchases {formatMoney(d.purchase)} &middot; purchase returns {formatMoney(d.purchaseReturns)} &middot; input tax {formatMoney(d.inputTax)}</p>
            <p>Purchases are a balance-sheet movement into stock, not a cost here &mdash; the cost of goods sold line is.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [selectedId, setSelectedId] = useState(REPORTS[0].id);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const selected = REPORTS.find((r) => r.id === selectedId) ?? REPORTS[0];
  const filteredReports = REPORTS.filter((r) => r.category === category);
  const reportUrl = buildUrl(selected, from, to, date);

  const { data, isLoading, error } = useQuery({
    queryKey: ['report', selectedId, from, to, date],
    queryFn: () => api<unknown>(reportUrl, { token }),
    enabled: !!token,
  });

  const exportReport = (type: string, format: 'xlsx' | 'csv' = 'xlsx') => {
    const qs = new URLSearchParams({ format });
    if (type === 'sales' || type === 'gstr1-json') {
      qs.set('from', from);
      qs.set('to', to);
    }
    const path = type === 'gstr1-json' ? 'gstr1-json' : type;
    const url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/exports/${path}?${qs}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (type === 'gstr1-json' ? r.json() : r.blob()))
      .then((result) => {
        if (type === 'gstr1-json') {
          const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'gstr1.json';
          a.click();
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(result as Blob);
          a.download = `${type}.${format}`;
          a.click();
        }
      });
  };

  const display = useMemo(() => {
    if (!data) return null;
    // Profit & Loss gets a purpose-built view: realised (money actually received) is the headline,
    // with the accrual figure beside it and the profit still out on credit called out plainly.
    if (selectedId === 'pnl' && isPnl(data)) return <ProfitAndLossView d={data} />;
    if (Array.isArray(data)) {
      if (!data.length) return <p className="text-muted-foreground p-4">No data for selected period</p>;
      const sample = data[0] as Record<string, unknown>;
      const cols = Object.keys(sample);
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{cols.map((c) => <th key={c} className="text-left p-2 whitespace-nowrap">{c}</th>)}</tr>
            </thead>
            <tbody>
              {data.slice(0, 100).map((row, i) => (
                <tr key={i} className="border-t">
                  {cols.map((c) => (
                    <td key={c} className="p-2 whitespace-nowrap">{renderValue((row as Record<string, unknown>)[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 100 && <p className="text-xs text-muted-foreground p-2">Showing first 100 of {data.length} rows</p>}
        </div>
      );
    }
    const obj = data as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([, v]) => typeof v !== 'object' || v === null);
    const nested = Object.entries(obj).filter(([, v]) => Array.isArray(v));
    return (
      <div className="space-y-4 p-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {entries.map(([k, v]) => (
            <div key={k} className="p-3 rounded-lg border bg-card">
              <p className="text-xs text-muted-foreground capitalize">{k.replace(/([A-Z])/g, ' $1')}</p>
              <p className="font-semibold mt-1">{renderValue(v)}</p>
            </div>
          ))}
        </div>
        {nested.map(([k, v]) => (
          <div key={k}>
            <p className="font-semibold mb-2 capitalize">{k.replace(/([A-Z])/g, ' $1')}</p>
            {Array.isArray(v) && v.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>{Object.keys(v[0] as object).map((c) => <th key={c} className="text-left p-2">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(v as Record<string, unknown>[]).slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-t">
                        {Object.keys(v[0] as object).map((c) => (
                          <td key={c} className="p-2">{renderValue(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }, [data, selectedId]);

  return (
    // Height is only pinned from lg up, where the two panes scroll independently. On phones a
    // fixed height would squeeze the report pane to nothing under the tall category rail.
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-4rem)]">
      <aside className="w-full lg:w-56 border-b lg:border-b-0 lg:border-r bg-card lg:shrink-0 lg:overflow-y-auto">
        <div className="p-3 border-b">
          <p className="text-xs font-bold text-muted-foreground uppercase">Categories</p>
        </div>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => {
              setCategory(cat);
              const first = REPORTS.find((r) => r.category === cat);
              if (first) setSelectedId(first.id);
            }}
            className={cn(
              'w-full text-left px-4 py-2.5 text-sm font-medium border-l-2',
              category === cat ? 'border-[hsl(348,85%,52%)] bg-[hsl(348,85%,97%)] text-[hsl(348,85%,52%)]' : 'border-transparent text-muted-foreground hover:bg-muted/50',
            )}
          >
            {cat}
          </button>
        ))}
        <div className="p-2 border-t">
          {filteredReports.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-sm',
                selectedId === r.id ? 'bg-[hsl(348,85%,52%)] text-white font-medium' : 'hover:bg-muted/50 text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
        <VyaparPageHeader
          title={selected.label}
          subtitle={`${selected.category} report`}
          action={
            selected.exportType ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => exportReport(selected.exportType!, 'xlsx')}>
                  <Download className="h-4 w-4 mr-1" /> Excel
                </Button>
                {selected.exportType !== 'gstr1-json' && (
                  <Button size="sm" variant="outline" onClick={() => exportReport(selected.exportType!, 'csv')}>
                    <Download className="h-4 w-4 mr-1" /> CSV
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />

        <div className="flex flex-wrap gap-2 items-end">
          {selected.needsDate && (
            <>
              <div>
                <label className="text-xs text-muted-foreground">From</label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-white" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">To</label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-white" />
              </div>
            </>
          )}
          {selected.needsDateOnly && (
            <div>
              <label className="text-xs text-muted-foreground">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-white" />
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card min-h-[300px]">
          {isLoading && <p className="p-8 text-center text-muted-foreground">Loading report…</p>}
          {error && <p className="p-8 text-center text-red-600">{(error as Error).message}</p>}
          {!isLoading && !error && display}
          {!isLoading && !error && !display && (
            <div className="p-12 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
              Select a report to view data
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
