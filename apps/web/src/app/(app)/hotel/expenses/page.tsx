'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wallet, Plus, TrendingUp, TrendingDown, CircleDollarSign, Trash2, Building, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency, cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Txn, TXN_STATUS_LABELS } from '@/lib/txn-meta';

type HotelReport = {
  monthRevenue: number;
  monthProfit: number;
  netProfit: number;
  totalRevenue: number;
};

type ExpenseCategory = { id: string; name: string };

function HotelExpensesContent() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const initialBranchId = searchParams.get('branchId') || '';

  const [selectedBranchId, setSelectedBranchId] = useState<string>(initialBranchId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    categoryId: '',
    amount: '',
    description: '',
    expenseDate: new Date().toISOString().split('T')[0],
  });

  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api('/branches?type=HOTEL', { token }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (branches && branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api<ExpenseCategory[]>('/expenses/categories', { token }),
  });

  const { data: expensesData } = useQuery<{ data: Txn[] }>({
    queryKey: ['hotel-expenses', selectedBranchId],
    queryFn: () => api(`/expenses?branchId=${selectedBranchId}&limit=200`, { token }),
    enabled: !!selectedBranchId,
  });

  const { data: hotelReport } = useQuery<HotelReport>({
    queryKey: ['hotel-profit', selectedBranchId],
    queryFn: () => api(`/reports/hotel?branchId=${selectedBranchId}`, { token }),
    enabled: !!selectedBranchId,
    refetchInterval: 30000,
  });

  const expenses = expensesData?.data ?? [];

  const monthExpensesTotal = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.total), 0),
    [expenses],
  );

  const createExpense = useMutation({
    mutationFn: () =>
      api('/expenses', {
        method: 'POST',
        token,
        body: JSON.stringify({
          branchId: selectedBranchId,
          expenseCategoryId: form.categoryId,
          total: parseFloat(form.amount),
          description: form.description,
          date: form.expenseDate,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hotel-expenses', selectedBranchId] });
      qc.invalidateQueries({ queryKey: ['hotel-profit', selectedBranchId] });
      toast.success('Expense recorded');
      setDialogOpen(false);
      setForm({ categoryId: categories?.[0]?.id ?? '', amount: '', description: '', expenseDate: new Date().toISOString().split('T')[0] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create expense'),
  });

  const deleteExpense = useMutation({
    mutationFn: (id: string) => api(`/txns/${id}`, { method: 'DELETE', token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hotel-expenses', selectedBranchId] });
      qc.invalidateQueries({ queryKey: ['hotel-profit', selectedBranchId] });
      toast.success('Expense deleted');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete'),
  });

  useEffect(() => {
    if (categories?.length && !form.categoryId) {
      setForm((f) => ({ ...f, categoryId: categories[0].id }));
    }
  }, [categories, form.categoryId]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-4 rounded-xl border">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            Hotel Expenses
          </h1>
          <p className="text-xs text-muted-foreground">Track branch expenses and P&amp;L from hotel report</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-10 rounded-lg border px-3 text-sm bg-background"
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <Link href={`/hotel?branchId=${selectedBranchId}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to PMS
            </Button>
          </Link>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Expense
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> Month Revenue
          </div>
          <p className="text-xl font-bold text-emerald-500">{formatCurrency(hotelReport?.monthRevenue ?? 0)}</p>
        </Card>
        <Card className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <TrendingDown className="h-3.5 w-3.5 text-red-500" /> Month Expenses
          </div>
          <p className="text-xl font-bold text-red-500">{formatCurrency(monthExpensesTotal)}</p>
        </Card>
        <Card className={cn('p-4 space-y-1', (hotelReport?.monthProfit ?? 0) < 0 ? 'bg-red-500/5' : '')}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
            <CircleDollarSign className="h-3.5 w-3.5 text-primary" /> Month Profit
          </div>
          <p className={cn('text-xl font-bold', (hotelReport?.monthProfit ?? 0) >= 0 ? 'text-primary' : 'text-red-500')}>
            {formatCurrency(hotelReport?.monthProfit ?? 0)}
          </p>
        </Card>
        <Card className="p-4 space-y-1">
          <div className="text-xs text-muted-foreground font-medium">Total Expenses (branch)</div>
          <p className="text-xl font-bold">{formatCurrency(expenses.reduce((s, e) => s + Number(e.total), 0))}</p>
        </Card>
      </div>

      <div className="space-y-1.5">
        {expenses.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground border border-dashed rounded-xl">
            No expenses for this hotel branch.
          </div>
        ) : (
          expenses.map((expense) => {
            const st = TXN_STATUS_LABELS[expense.status] ?? { label: expense.status, className: 'bg-gray-100' };
            return (
              <Card key={expense.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold">{formatCurrency(Number(expense.total))}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', st.className)}>{st.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{expense.description ?? expense.txnNumber}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    {new Date(expense.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500 hover:text-red-600 shrink-0"
                  disabled={deleteExpense.isPending}
                  onClick={() => deleteExpense.mutate(expense.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Card>
            );
          })
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Hotel Expense</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Enter a valid amount');
              if (!form.description.trim()) return toast.error('Description is required');
              if (!form.categoryId) return toast.error('Select a category');
              createExpense.mutate();
            }}
            className="space-y-4 py-2"
          >
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Amount (₹)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Category</span>
              <select
                className="w-full h-10 rounded-lg border px-3 text-sm"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                {(categories ?? []).map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Description</span>
              <textarea
                rows={3}
                required
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Date</span>
              <input
                type="date"
                required
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
            </label>
            <div className="flex gap-2 pt-2">
              <DialogClose asChild>
                <Button variant="outline" type="button" className="flex-1">Cancel</Button>
              </DialogClose>
              <Button type="submit" className="flex-1" disabled={createExpense.isPending}>Save Expense</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function HotelExpensesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-muted-foreground">Loading hotel expenses...</div>}>
      <HotelExpensesContent />
    </Suspense>
  );
}
