'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Hash, Receipt, Users, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Permission } from '@nexus/shared';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { PermissionGate } from '@/components/permission-gate';
import { CloudInsightsSettings } from '@/components/settings/cloud-insights-settings';
import { LabelDesignerCard } from '@/components/settings/label-designer-card';
import { ThermalFormatCard } from '@/components/settings/thermal-format-card';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { TXN_META, TxnType } from '@/lib/txn-meta';

interface FirmSettings {
  gstEnabled: boolean;
  hsnEnabled: boolean;
  roundOffEnabled: boolean;
  printTheme?: string;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  termsAndConditions?: string | null;
  txnPrefixes?: Record<string, string>;
  sequences?: { txnType: string; prefix: string; nextNumber: number }[];
  business?: { name: string; email: string; gstNumber?: string | null };
}

const NUMBERING_TYPES: TxnType[] = [
  'SALE_INVOICE', 'ESTIMATE', 'SALE_ORDER', 'CREDIT_NOTE', 'PAYMENT_IN',
  'PURCHASE_BILL', 'PURCHASE_ORDER', 'DEBIT_NOTE', 'PAYMENT_OUT', 'EXPENSE',
];

export default function SettingsPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['firm-settings'],
    queryFn: () => api<FirmSettings>('/settings/firm', { token }),
  });

  const updateFirm = useMutation({
    mutationFn: (body: Partial<FirmSettings>) =>
      api('/settings/firm', { method: 'PATCH', token, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-settings'] });
      toast.success('Settings saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [bizName, setBizName] = useState('');
  useEffect(() => { if (data?.business?.name != null) setBizName(data.business.name); }, [data?.business?.name]);

  const updateBusiness = useMutation({
    mutationFn: (name: string) => api('/businesses/me', { method: 'PATCH', token, body: JSON.stringify({ name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-settings'] });
      toast.success('Business name updated — it will show on new printed receipts');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateNumbering = useMutation({
    mutationFn: (body: { txnType: string; prefix: string; nextNumber?: number }) =>
      api('/settings/numbering', { method: 'POST', token, body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm-settings'] });
      toast.success('Numbering updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const seqMap = new Map((data?.sequences ?? []).map((s) => [s.txnType, s]));

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl">
      <VyaparPageHeader title="Settings" subtitle="Firm, invoice and transaction settings" />

      <Card className="p-6 space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="h-5 w-5" />
          <span className="text-sm font-medium">Business</span>
        </div>
        <PermissionGate
          permission={Permission.BUSINESS_MANAGE}
          fallback={<p className="font-semibold text-lg">{data?.business?.name}</p>}
        >
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Business name (shown on printed receipts)</label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-10 max-w-xs"
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                placeholder="Your shop / business name"
              />
              <Button
                onClick={() => updateBusiness.mutate(bizName.trim())}
                disabled={
                  updateBusiness.isPending ||
                  !bizName.trim() ||
                  bizName.trim() === (data?.business?.name ?? '')
                }
              >
                Save
              </Button>
            </div>
          </div>
        </PermissionGate>
        <p className="text-muted-foreground">{data?.business?.email}</p>
        {data?.business?.gstNumber && <p className="text-sm">GST: {data.business.gstNumber}</p>}
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-[hsl(348,85%,52%)]" />
          <h2 className="font-semibold">Invoice & Tax</h2>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data?.gstEnabled ?? true}
            onChange={(e) => updateFirm.mutate({ gstEnabled: e.target.checked })}
            className="rounded h-4 w-4"
          />
          <span className="text-sm">Enable GST on invoices</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data?.hsnEnabled ?? true}
            onChange={(e) => updateFirm.mutate({ hsnEnabled: e.target.checked })}
            className="rounded h-4 w-4"
          />
          <span className="text-sm">Show HSN/SAC codes</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={data?.roundOffEnabled ?? true}
            onChange={(e) => updateFirm.mutate({ roundOffEnabled: e.target.checked })}
            className="rounded h-4 w-4"
          />
          <span className="text-sm">Round off invoice totals</span>
        </label>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Terms & Conditions</label>
          <textarea
            className="w-full rounded-lg border p-3 text-sm min-h-[80px]"
            defaultValue={data?.termsAndConditions ?? ''}
            onBlur={(e) => {
              if (e.target.value !== (data?.termsAndConditions ?? '')) {
                updateFirm.mutate({ termsAndConditions: e.target.value });
              }
            }}
          />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Thermal Receipt</h2>
          <p className="text-xs text-muted-foreground">Customize the 80mm thermal bill — a header line under the shop name and a footer line at the bottom of every printed receipt.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Header line (under shop name)</label>
          <input
            className="w-full rounded-lg border p-2 text-sm"
            placeholder="e.g. 123 Main St · +91 98765 43210"
            defaultValue={data?.receiptHeader ?? ''}
            onBlur={(e) => { if (e.target.value !== (data?.receiptHeader ?? '')) updateFirm.mutate({ receiptHeader: e.target.value }); }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Footer line (bottom of bill)</label>
          <input
            className="w-full rounded-lg border p-2 text-sm"
            placeholder="e.g. Thank you! Visit again."
            defaultValue={data?.receiptFooter ?? ''}
            onBlur={(e) => { if (e.target.value !== (data?.receiptFooter ?? '')) updateFirm.mutate({ receiptFooter: e.target.value }); }}
          />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-[hsl(348,85%,52%)]" />
          <h2 className="font-semibold">Transaction Numbering</h2>
        </div>
        <div className="space-y-3">
          {NUMBERING_TYPES.map((txnType) => {
            const seq = seqMap.get(txnType);
            const prefix = seq?.prefix ?? data?.txnPrefixes?.[txnType] ?? '';
            const next = seq?.nextNumber ?? 1;
            return (
              <div key={txnType} className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-muted/20">
                <span className="text-sm font-medium w-36 shrink-0">{TXN_META[txnType].label}</span>
                <Input
                  className="h-9 w-24"
                  defaultValue={prefix}
                  placeholder="Prefix"
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== prefix) {
                      updateNumbering.mutate({ txnType, prefix: e.target.value, nextNumber: next });
                    }
                  }}
                />
                <Input
                  type="number"
                  className="h-9 w-20"
                  defaultValue={next}
                  min={1}
                  onBlur={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (n && n !== next && prefix) {
                      updateNumbering.mutate({ txnType, prefix, nextNumber: n });
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">next #</span>
              </div>
            );
          })}
        </div>
      </Card>

      <ThermalFormatCard />

      <LabelDesignerCard />

      <CloudInsightsSettings />

      <Link href="/settings/users">
        <Card className="p-4 sm:p-6 flex flex-wrap items-center justify-between gap-3 hover:shadow-md transition-shadow cursor-pointer">
          <div className="flex min-w-0 items-center gap-3">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <p className="font-semibold">Staff management</p>
              <p className="text-sm text-muted-foreground">Users, roles & permissions</p>
            </div>
          </div>
          <Button variant="outline" size="sm">Manage</Button>
        </Card>
      </Link>

      <Link href="/settings/account">
        <Card className="p-4 sm:p-6 flex flex-wrap items-center justify-between gap-3 hover:shadow-md transition-shadow cursor-pointer">
          <div className="flex min-w-0 items-center gap-3">
            <KeyRound className="h-8 w-8 text-primary" />
            <div>
              <p className="font-semibold">Change password</p>
              <p className="text-sm text-muted-foreground">Update your account password</p>
            </div>
          </div>
          <Button variant="outline" size="sm">Change</Button>
        </Card>
      </Link>
    </div>
  );
}
