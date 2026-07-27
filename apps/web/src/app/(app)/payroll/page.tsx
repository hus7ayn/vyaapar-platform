'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, Plus, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatMoney } from '@/lib/txn-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { printHtmlDocument } from '@/lib/print-html';

interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  department?: string | null;
  designation?: string | null;
  baseSalary: string | number;
  advanceBalance?: string | number;
  branch?: { name: string; code: string } | null;
}

interface PayrollLine {
  id: string;
  baseSalary: string | number;
  overtime: string | number;
  bonus: string | number;
  deductions: string | number;
  advance: string | number;
  netSalary: string | number;
  employee: { id: string; firstName: string; lastName: string; employeeId: string };
}

interface PayrollRun {
  id: string;
  period: string;
  status: string;
  totalAmount: string | number;
  paymentMode?: string | null;
  paidAt?: string | null;
  lines: PayrollLine[];
  branch?: { name: string } | null;
  expenseTxn?: { txnNumber: string; date: string } | null;
}

interface PayrollSummary {
  paidRuns: number;
  totalPaid: number;
}

interface BankAccount {
  id: string;
  name: string;
  accountType: string;
}

const EMPTY_EMP = {
  employeeId: '',
  firstName: '',
  lastName: '',
  department: '',
  designation: '',
  baseSalary: '',
};

export default function PayrollPage() {
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const activeShopId = useAuthStore((s) => s.activeShopId);
  const qc = useQueryClient();

  const [tab, setTab] = useState<'staff' | 'runs' | 'history'>('staff');
  const [historyEmpId, setHistoryEmpId] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [empOpen, setEmpOpen] = useState(false);
  const [empForm, setEmpForm] = useState(EMPTY_EMP);
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<'CASH' | 'BANK'>('CASH');
  const [bankAccountId, setBankAccountId] = useState('');
  const [advanceFor, setAdvanceFor] = useState<Employee | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [historyFor, setHistoryFor] = useState<Employee | null>(null);

  // Scope payroll to ONE shop so their staff stay separate.
  const [entityId, setEntityId] = useState<string>(activeShopId ?? '');
  const { data: entities } = useQuery({
    queryKey: ['branches', 'ALL'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/branches', { token }),
    enabled: !!token,
  });
  useEffect(() => {
    if (!entityId && (entities?.length ?? 0) > 0) {
      setEntityId(activeShopId && entities!.some((e) => e.id === activeShopId) ? activeShopId : entities![0].id);
    }
  }, [entities, entityId, activeShopId]);
  const scope = entityId || undefined;

  const { data: employees } = useQuery({
    queryKey: ['employees', entityId],
    queryFn: () => api<Employee[]>('/payroll/employees', { token, branchId: scope }),
    enabled: !!token,
  });

  const { data: payrolls } = useQuery({
    queryKey: ['payrolls', entityId],
    queryFn: () => api<PayrollRun[]>('/payroll', { token, branchId: scope }),
    enabled: !!token,
  });

  const { data: summary } = useQuery({
    queryKey: ['payroll-summary', entityId],
    queryFn: () => api<PayrollSummary>('/payroll/summary', { token, branchId: scope }),
    enabled: !!token,
  });

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts-payroll'],
    queryFn: () => api<BankAccount[]>('/cash-bank/accounts', { token }),
    enabled: !!token && payOpen !== null,
  });

  const createEmp = useMutation({
    mutationFn: () =>
      api('/payroll/employees', {
        method: 'POST',
        token,
        branchId: scope,
        body: JSON.stringify({
          ...empForm,
          baseSalary: Number(empForm.baseSalary),
        }),
      }),
    onSuccess: () => {
      toast.success('Staff added');
      setEmpOpen(false);
      setEmpForm(EMPTY_EMP);
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: () => api<{ created: number; skipped: number }>('/payroll/generate', { method: 'POST', token, body: JSON.stringify({ startDate, endDate, branchId: scope }) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['payrolls'] });
      toast.success(`Payroll generated for ${res.created} shop(s) — all active staff`);
      setTab('runs');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payRun = useMutation({
    mutationFn: (payrollId: string) =>
      api(`/payroll/${payrollId}/pay`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          paymentType: payMode,
          bankAccountId: payMode === 'BANK' ? bankAccountId || undefined : undefined,
        }),
      }),
    onSuccess: () => {
      toast.success('Salary paid — deducted from cash/bank & revenue');
      setPayOpen(null);
      qc.invalidateQueries({ queryKey: ['payrolls'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['cash-bank-summary'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLine = useMutation({
    mutationFn: ({ payrollId, lineId, ...patch }: { payrollId: string; lineId: string; overtime?: number; bonus?: number; deductions?: number; advance?: number }) =>
      api(`/payroll/${payrollId}/lines/${lineId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payrolls'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const recordAdvance = useMutation({
    mutationFn: ({ employeeId, amount }: { employeeId: string; amount: number }) =>
      api(`/payroll/employees/${employeeId}/advance`, { method: 'POST', token, body: JSON.stringify({ amount }) }),
    onSuccess: () => {
      toast.success('Advance recorded — auto-deducted from upcoming payroll');
      setAdvanceFor(null);
      setAdvanceAmount('');
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Per-employee salary history: their lines across every generated run.
  const employeeHistory = (empId: string) =>
    (payrolls ?? [])
      .map((p) => ({ run: p, line: p.lines.find((l) => l.employee.id === empId) }))
      .filter((x): x is { run: PayrollRun; line: PayrollLine } => !!x.line);

  // Enriched salary-history view for one employee — shared by the "Salary History" tab and the
  // per-row History dialog. Shows payment date/mode + full salary breakdown + totals.
  const salaryHistoryTable = (emp: Employee) => {
    const hist = employeeHistory(emp.id);
    if (!hist.length) {
      return <p className="text-sm text-muted-foreground py-4">No payroll runs yet for {emp.firstName} {emp.lastName}. Generate a run in the <b>Payroll Runs</b> tab, then their salary history appears here.</p>;
    }
    const paid = hist.filter((h) => h.run.status === 'PAID');
    const totalPaid = paid.reduce((s, h) => s + Number(h.line.netSalary), 0);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {emp.designation && <span className="text-muted-foreground">{emp.designation}</span>}
          <span>Monthly base: <b>{formatMoney(emp.baseSalary)}</b></span>
          <span>Total paid: <b className="text-emerald-700">{formatMoney(totalPaid)}</b> across {paid.length} run{paid.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="py-1 text-left">Period</th>
                <th className="py-1 text-left">Paid on</th>
                <th className="py-1 text-right">Base</th>
                <th className="py-1 text-right">OT</th>
                <th className="py-1 text-right">Bonus</th>
                <th className="py-1 text-right">Deductions</th>
                <th className="py-1 text-right">Advance</th>
                <th className="py-1 text-right">Net</th>
                <th className="py-1 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {hist.map(({ run, line }) => (
                <tr key={run.id} className="border-b last:border-0">
                  <td className="py-1.5 whitespace-nowrap">{run.period}</td>
                  <td className="py-1.5 text-muted-foreground whitespace-nowrap">
                    {run.status === 'PAID'
                      ? (run.paidAt ? new Date(run.paidAt).toLocaleDateString('en-IN') : 'Paid')
                      : <span className="capitalize">{run.status.toLowerCase()}</span>}
                    {run.status === 'PAID' && run.paymentMode ? ` · ${run.paymentMode}` : ''}
                  </td>
                  <td className="py-1.5 text-right">{formatMoney(line.baseSalary)}</td>
                  <td className="py-1.5 text-right">{formatMoney(line.overtime)}</td>
                  <td className="py-1.5 text-right">{formatMoney(line.bonus)}</td>
                  <td className="py-1.5 text-right text-rose-600">{Number(line.deductions) > 0 ? `-${formatMoney(line.deductions)}` : formatMoney(0)}</td>
                  <td className="py-1.5 text-right">{formatMoney(line.advance)}</td>
                  <td className="py-1.5 text-right font-semibold">{formatMoney(line.netSalary)}</td>
                  <td className="py-1.5 text-right"><Button size="sm" variant="ghost" className="h-7" onClick={() => printPayslip(run, line)}>Payslip</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // One payslip's inner HTML (no <html>/<head>) so it can be printed alone or
  // concatenated for a whole run.
  const payslipBody = (run: PayrollRun, line: PayrollLine) => {
    const row = (k: string, v: string | number) =>
      `<tr><td style="padding:4px 0">${k}</td><td style="padding:4px 0;text-align:right">${typeof v === 'number' ? formatMoney(v) : v}</td></tr>`;
    return `<section class="slip">
<h2>Payslip</h2>
<p style="color:#666;margin:4px 0">${run.branch?.name ?? 'Shop'} · Period ${run.period}</p>
<hr/>
<p><b>${line.employee.firstName} ${line.employee.lastName}</b> (${line.employee.employeeId})</p>
<table>
${row('Base salary', Number(line.baseSalary))}
${row('Overtime', Number(line.overtime))}
${row('Bonus', Number(line.bonus))}
${row('Deductions', '-' + formatMoney(Number(line.deductions)))}
${row('Advance recovered', '-' + formatMoney(Number(line.advance)))}
<tr class="net"><td style="padding:8px 0">Net pay</td><td style="padding:8px 0;text-align:right">${formatMoney(Number(line.netSalary))}</td></tr>
</table>
<hr/>
<p style="color:#666;font-size:12px">Status: ${run.status}${run.paidAt ? ` · Paid ${new Date(run.paidAt).toLocaleDateString('en-IN')}` : ''}</p>
</section>`;
  };

  const PAYSLIP_STYLE = `<style>body{font-family:Arial,sans-serif;color:#111}.slip{max-width:420px;margin:24px auto;page-break-after:always}h2{margin:0}hr{border:none;border-top:1px solid #ddd;margin:12px 0}table{width:100%;border-collapse:collapse;font-size:14px}.net{font-weight:700;font-size:16px;border-top:2px solid #111}</style>`;

  const printPayslip = (run: PayrollRun, line: PayrollLine) => {
    printHtmlDocument(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payslip</title>${PAYSLIP_STYLE}</head><body>${payslipBody(run, line)}</body></html>`);
  };

  const printAllPayslips = (run: PayrollRun) => {
    if (!run.lines.length) { toast.error('No employees in this run'); return; }
    const body = run.lines.map((l) => payslipBody(run, l)).join('');
    printHtmlDocument(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payslips ${run.period}</title>${PAYSLIP_STYLE}</head><body>${body}</body></html>`);
  };

  const fieldCls = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm';

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Staff Payroll
          </h1>
          <p className="text-sm text-muted-foreground">
            Staff, runs &amp; payslips are scoped to the selected shop below — each shop stays separate
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="h-10 rounded-lg border px-3 text-sm bg-background"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            title="Payroll entity"
          >
            {(entities ?? []).map((en) => (
              <option key={en.id} value={en.id}>{en.name}</option>
            ))}
          </select>
          <div className="text-right text-sm hidden sm:block">
            <p className="text-muted-foreground">Paid this month</p>
            <p className="font-bold text-red-600">{formatMoney(summary?.totalPaid ?? 0)}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {(['staff', 'runs', 'history'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
              tab === t ? 'border-[hsl(348,85%,52%)] text-[hsl(348,85%,52%)]' : 'border-transparent text-muted-foreground',
            )}
          >
            {t === 'staff' ? `Staff (${employees?.length ?? 0})` : t === 'runs' ? `Payroll Runs (${payrolls?.length ?? 0})` : 'Salary History'}
          </button>
        ))}
      </div>

      {tab === 'staff' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Staff for the selected shop</p>
            <Button onClick={() => setEmpOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Staff</Button>
          </div>
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b bg-slate-50">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">NAME</th>
                  <th className="px-3 py-2 text-left">ROLE</th>
                  <th className="px-3 py-2 text-right">MONTHLY SALARY</th>
                  <th className="px-3 py-2 text-right">ADVANCE DUE</th>
                  <th className="px-3 py-2 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {!(employees ?? []).length && (
                  <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No staff for this entity yet</td></tr>
                )}
                {(employees ?? []).map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{e.employeeId}</td>
                    <td className="px-3 py-2 font-medium">{e.firstName} {e.lastName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.designation ?? e.department ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(e.baseSalary)}</td>
                    <td className={cn('px-3 py-2 text-right', Number(e.advanceBalance ?? 0) > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                      {formatMoney(Number(e.advanceBalance ?? 0))}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" className="h-7 mr-1" onClick={() => { setAdvanceFor(e); setAdvanceAmount(''); }}>Advance</Button>
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setHistoryFor(e)}>History</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'runs' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-sm text-muted-foreground">From</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            <label className="text-sm text-muted-foreground">to</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            <Button onClick={() => generate.mutate()} disabled={generate.isPending || !startDate || !endDate}>
              <Users className="h-4 w-4 mr-1" /> Generate payroll
            </Button>
          </div>

          <div className="grid gap-4">
            {(payrolls ?? []).map((p) => (
              <div key={p.id} className="bg-white rounded-lg border shadow-sm p-4">
                <div className="flex flex-wrap justify-between items-start gap-3 mb-3">
                  <div>
                    <p className="font-semibold">{p.period} · {p.branch?.name ?? 'Shop'}</p>
                    <p className="text-sm text-muted-foreground capitalize">{p.status}</p>
                    {p.expenseTxn && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Expense {p.expenseTxn.txnNumber} · paid {p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN') : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold">{formatMoney(p.totalAmount)}</p>
                    <div className="mt-2 flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => printAllPayslips(p)}>
                        Print all payslips
                      </Button>
                      {p.status !== 'PAID' && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setPayOpen(p.id)}>
                          <Banknote className="h-4 w-4 mr-1" /> Pay Salary
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="py-1 text-left">Staff</th>
                      <th className="py-1 text-right">Base</th>
                      <th className="py-1 text-right">Bonus</th>
                      <th className="py-1 text-right">Deductions</th>
                      <th className="py-1 text-right">Advance</th>
                      <th className="py-1 text-right">Net</th>
                      <th className="py-1 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="py-1.5">{l.employee.firstName} {l.employee.lastName}</td>
                        <td className="py-1.5 text-right">{formatMoney(l.baseSalary)}</td>
                        <td className="py-1.5 text-right">
                          {p.status === 'PAID' ? formatMoney(l.bonus) : (
                            <Input type="number" min="0" className="h-7 w-20 ml-auto text-right" defaultValue={Number(l.bonus)}
                              onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(l.bonus)) updateLine.mutate({ payrollId: p.id, lineId: l.id, bonus: v }); }} />
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          {p.status === 'PAID' ? formatMoney(l.deductions) : (
                            <Input type="number" min="0" className="h-7 w-20 ml-auto text-right" defaultValue={Number(l.deductions)}
                              onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(l.deductions)) updateLine.mutate({ payrollId: p.id, lineId: l.id, deductions: v }); }} />
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          {p.status === 'PAID' ? formatMoney(l.advance) : (
                            <Input type="number" min="0" className="h-7 w-20 ml-auto text-right" defaultValue={Number(l.advance)}
                              onBlur={(e) => { const v = Number(e.target.value); if (v !== Number(l.advance)) updateLine.mutate({ payrollId: p.id, lineId: l.id, advance: v }); }} />
                          )}
                        </td>
                        <td className="py-1.5 text-right font-medium">{formatMoney(l.netSalary)}</td>
                        <td className="py-1.5 text-right">
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => printPayslip(p, l)}>Payslip</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {!(payrolls ?? []).length && (
              <p className="text-center text-muted-foreground py-10">No payroll runs yet. Add staff and generate payroll.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div>
              <h2 className="font-semibold">Salary History</h2>
              <p className="text-sm text-muted-foreground">Past payroll records per employee — amounts, payment dates, deductions and net pay.</p>
            </div>
            <select
              className="sm:ml-auto h-10 rounded-lg border px-3 text-sm bg-background w-full sm:w-64"
              value={historyEmpId}
              onChange={(e) => setHistoryEmpId(e.target.value)}
            >
              <option value="">Select an employee…</option>
              {(employees ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.firstName} {e.lastName}{e.employeeId ? ` (${e.employeeId})` : ''}</option>
              ))}
            </select>
          </div>
          {(() => {
            const emp = (employees ?? []).find((e) => e.id === historyEmpId);
            if (!emp) return <p className="text-sm text-muted-foreground py-4">Choose an employee to view their salary history.</p>;
            return salaryHistoryTable(emp);
          })()}
        </div>
      )}

      <Dialog open={empOpen} onOpenChange={setEmpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Employee ID (e.g. EMP-002)" value={empForm.employeeId} onChange={(e) => setEmpForm((f) => ({ ...f, employeeId: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="First name" value={empForm.firstName} onChange={(e) => setEmpForm((f) => ({ ...f, firstName: e.target.value }))} />
              <Input placeholder="Last name" value={empForm.lastName} onChange={(e) => setEmpForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <Input placeholder="Designation" value={empForm.designation} onChange={(e) => setEmpForm((f) => ({ ...f, designation: e.target.value }))} />
            <Input placeholder="Department" value={empForm.department} onChange={(e) => setEmpForm((f) => ({ ...f, department: e.target.value }))} />
            <Input type="number" placeholder="Monthly salary" value={empForm.baseSalary} onChange={(e) => setEmpForm((f) => ({ ...f, baseSalary: e.target.value }))} />
            <Button className="w-full" disabled={createEmp.isPending} onClick={() => createEmp.mutate()}>Add to {entities?.find((e) => e.id === entityId)?.name ?? 'Selected Entity'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payOpen} onOpenChange={(o) => !o && setPayOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay Staff Salary</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This creates a Salary expense, deducts from cash/bank, and reduces net revenue for this shop.
          </p>
          <div className="space-y-3">
            <select className={fieldCls} value={payMode} onChange={(e) => setPayMode(e.target.value as 'CASH' | 'BANK')}>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
            </select>
            {payMode === 'BANK' && (
              <select className={fieldCls} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                <option value="">Select bank account</option>
                {(accounts ?? []).filter((a) => a.accountType === 'BANK').map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
            <Button
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={payRun.isPending || (payMode === 'BANK' && !bankAccountId)}
              onClick={() => payOpen && payRun.mutate(payOpen)}
            >
              Confirm Payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Give salary advance */}
      <Dialog open={!!advanceFor} onOpenChange={(o) => !o && setAdvanceFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Salary advance{advanceFor ? ` — ${advanceFor.firstName} ${advanceFor.lastName}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {advanceFor && Number(advanceFor.advanceBalance ?? 0) > 0 && (
              <p className="text-sm text-muted-foreground">Current outstanding advance: <span className="font-medium text-amber-600">{formatMoney(Number(advanceFor.advanceBalance ?? 0))}</span></p>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Advance amount</label>
              <Input type="number" min="0" step="0.01" autoFocus value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} placeholder="0.00" />
            </div>
            <p className="text-[11px] text-muted-foreground">This is automatically deducted from the employee&apos;s upcoming payroll run(s) until cleared.</p>
            <Button
              className="w-full"
              disabled={recordAdvance.isPending || !(Number(advanceAmount) > 0)}
              onClick={() => advanceFor && recordAdvance.mutate({ employeeId: advanceFor.id, amount: Number(advanceAmount) })}
            >
              Record advance
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Per-employee salary history */}
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Salary history{historyFor ? ` — ${historyFor.firstName} ${historyFor.lastName}` : ''}</DialogTitle></DialogHeader>
          {historyFor && salaryHistoryTable(historyFor)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
