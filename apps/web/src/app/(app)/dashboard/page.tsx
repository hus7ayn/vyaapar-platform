'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  FileText,
  Landmark,
  Package,
  ShoppingBag,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate, formatMoney, TXN_META, Txn, TxnType } from '@/lib/txn-meta';
import { cn } from '@/lib/utils';

interface DashboardData {
  todaySale: number;
  todayInvoices: number;
  monthSale: number;
  monthInvoices: number;
  monthExpense: number;
  monthReturns?: number;
  monthSalary?: number;
  netRevenue?: number;
  totalReceivable: number;
  totalPayable: number;
  cashInHand: number;
  bankBalance: number;
  stockValue: number;
  lowStockCount: number;
  openOrders: number;
  salesGraph: { date: string; total: number }[];
  recentTxns: Txn[];
}

export default function DashboardPage() {
  const token = useAuthStore((s) => s.accessToken) ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/reports/dashboard', { token }),
    enabled: !!token,
    refetchInterval: 60_000,
  });

  const maxGraph = Math.max(1, ...(data?.salesGraph ?? []).map((d) => d.total));

  const shortcuts = [
    { href: '/sale/invoices/new', label: 'Add Sale', icon: FileText, color: 'bg-red-600' },
    { href: '/purchase/bills/new', label: 'Add Purchase', icon: ShoppingBag, color: 'bg-blue-600' },
    { href: '/sale/payment-in/new', label: 'Payment In', icon: ArrowDownLeft, color: 'bg-green-600' },
    { href: '/purchase/payment-out/new', label: 'Payment Out', icon: ArrowUpRight, color: 'bg-orange-500' },
    { href: '/sale/estimates/new', label: 'Estimate', icon: ClipboardList, color: 'bg-purple-600' },
    { href: '/expenses/new', label: 'Expense', icon: Banknote, color: 'bg-rose-500' },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Home</h1>
          <p className="text-sm text-muted-foreground">Business overview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {shortcuts.slice(0, 2).map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.label} href={s.href} className={cn('flex items-center gap-2 rounded-lg px-3 sm:px-4 py-2 text-sm font-semibold text-white shadow', s.color)}>
                <Icon className="h-4 w-4" /> {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Receivable / payable hero cards (Vyapar style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/parties" className="bg-white rounded-xl border shadow-sm p-4 hover:shadow transition-shadow">
          <div className="flex items-center gap-2 text-green-700 mb-1">
            <ArrowDownLeft className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase">You&apos;ll Receive</p>
          </div>
          <p className="text-2xl font-bold text-green-700">{formatMoney(data?.totalReceivable ?? 0)}</p>
        </Link>
        <Link href="/parties" className="bg-white rounded-xl border shadow-sm p-4 hover:shadow transition-shadow">
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <ArrowUpRight className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase">You&apos;ll Pay</p>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatMoney(data?.totalPayable ?? 0)}</p>
        </Link>
        <Link href="/cash-bank" className="bg-white rounded-xl border shadow-sm p-4 hover:shadow transition-shadow">
          <div className="flex items-center gap-2 text-blue-700 mb-1">
            <Landmark className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase">Cash + Bank</p>
          </div>
          <p className="text-2xl font-bold">{formatMoney((data?.cashInHand ?? 0) + (data?.bankBalance ?? 0))}</p>
          <p className="text-xs text-muted-foreground mt-1">Cash {formatMoney(data?.cashInHand ?? 0)} · Bank {formatMoney(data?.bankBalance ?? 0)}</p>
        </Link>
        <Link href="/items" className="bg-white rounded-xl border shadow-sm p-4 hover:shadow transition-shadow">
          <div className="flex items-center gap-2 text-amber-700 mb-1">
            <Package className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase">Stock Value</p>
          </div>
          <p className="text-2xl font-bold">{formatMoney(data?.stockValue ?? 0)}</p>
          {(data?.lowStockCount ?? 0) > 0 && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {data!.lowStockCount} low stock items
            </p>
          )}
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sale graph */}
        <div className="lg:col-span-2 bg-white rounded-xl border shadow-sm p-4">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
            <div>
              <p className="font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-red-600" /> Sales — Last 7 Days</p>
              <p className="text-xs text-muted-foreground">
                Today: <span className="font-semibold text-foreground">{formatMoney(data?.todaySale ?? 0)}</span> ({data?.todayInvoices ?? 0} invoices)
                {' · '}This month: <span className="font-semibold text-foreground">{formatMoney(data?.monthSale ?? 0)}</span>
              </p>
            </div>
            <Link href="/reports" className="text-xs text-red-600 font-semibold hover:underline">View Reports →</Link>
          </div>
          <div className="flex items-end gap-2 h-40">
            {(data?.salesGraph ?? []).map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{d.total > 0 ? formatMoney(d.total).replace('.00', '') : ''}</span>
                <div
                  className="w-full rounded-t bg-gradient-to-t from-red-600 to-red-400 min-h-[2px]"
                  style={{ height: `${Math.max(2, (d.total / maxGraph) * 120)}px` }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}
                </span>
              </div>
            ))}
            {isLoading && <p className="text-sm text-muted-foreground m-auto">Loading…</p>}
          </div>
        </div>

        {/* Quick links + month summary */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border shadow-sm p-4">
            <p className="font-semibold mb-3">Quick Actions</p>
            <div className="grid grid-cols-3 gap-2">
              {shortcuts.map((s) => {
                const Icon = s.icon;
                return (
                  <Link key={s.label} href={s.href} className="flex flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-red-50 transition-colors">
                    <div className={cn('h-10 w-10 rounded-full flex items-center justify-center text-white shadow-sm', s.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] font-semibold text-center leading-tight">{s.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-4 space-y-2 text-sm">
            <p className="font-semibold">This Month</p>
            <div className="flex justify-between"><span className="text-muted-foreground">Sale</span><span className="font-semibold">{formatMoney(data?.monthSale ?? 0)}</span></div>
            {(data?.monthReturns ?? 0) > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Sale Returns</span><span className="font-semibold text-red-600">{formatMoney(data!.monthReturns!)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">Expenses</span><span className="font-semibold text-red-600">{formatMoney(data?.monthExpense ?? 0)}</span></div>
            {(data?.monthSalary ?? 0) > 0 && (
              <div className="flex justify-between pl-3 text-xs"><span className="text-muted-foreground">↳ incl. Staff Salary</span><span className="text-muted-foreground">{formatMoney(data!.monthSalary!)}</span></div>
            )}
            <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground font-medium">Net (Sales &minus; Costs)</span><span className="font-bold text-green-700">{formatMoney(data?.netRevenue ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Open Orders</span><span className="font-semibold">{data?.openOrders ?? 0}</span></div>
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">Recent Transactions</p>
          <Link href="/reports" className="text-xs text-red-600 font-semibold hover:underline">All Transactions →</Link>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-xs text-muted-foreground bg-slate-50">
              <th className="px-4 py-2 text-left">TYPE</th>
              <th className="px-4 py-2 text-left">NUMBER</th>
              <th className="px-4 py-2 text-left">PARTY</th>
              <th className="px-4 py-2 text-left">DATE</th>
              <th className="px-4 py-2 text-right">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recentTxns ?? []).map((t) => {
              const meta = TXN_META[t.txnType as TxnType];
              return (
                <tr key={t.id} className="border-t hover:bg-red-50/40">
                  <td className="px-4 py-2">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', meta?.color ?? 'bg-gray-50 text-gray-600')}>
                      {meta?.label ?? t.txnType}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium">{t.txnNumber}</td>
                  <td className="px-4 py-2">{t.partyName ?? t.party?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(t.date)}</td>
                  <td className="px-4 py-2 text-right font-semibold">{formatMoney(t.total)}</td>
                </tr>
              );
            })}
            {!isLoading && !(data?.recentTxns ?? []).length && (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No transactions yet</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
