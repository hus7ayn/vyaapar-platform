'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Card } from '@/components/ui/card';
import { Permission, ROLE_LABELS, ROLE_PERMISSIONS, SystemRole, isStrongPassword, PASSWORD_MIN_LENGTH } from '@nexus/shared';
import { usePermissions } from '@/hooks/use-permissions';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
}

interface BranchRow {
  id: string;
  name: string;
  code: string;
}

// Business-wide roles (holding BUSINESS_MANAGE) can only be created by a
// platform super admin when the tenant is set up — not selectable here.
const ASSIGNABLE_ROLES = Object.entries(ROLE_LABELS).filter(
  ([key]) => key !== SystemRole.SUPER_ADMIN && !(ROLE_PERMISSIONS[key] ?? []).includes(Permission.BUSINESS_MANAGE),
);
const ASSIGNABLE_KEYS = new Set(ASSIGNABLE_ROLES.map(([key]) => key));

// The three access tiers the product exposes (Super Admin sits above these and
// is provisioned at tenant setup). The 9 granular roles map onto them.
const ROLE_TIERS: { label: string; roles: SystemRole[] }[] = [
  { label: 'Manager — full access to the assigned shop', roles: [SystemRole.BRANCH_MANAGER, SystemRole.ACCOUNTANT] },
  { label: 'Biller / Cashier — POS billing only', roles: [SystemRole.BILLER] },
  { label: 'Hotel staff', roles: [SystemRole.RECEPTIONIST, SystemRole.HOUSEKEEPING, SystemRole.MAINTENANCE_STAFF] },
];

const ROLE_DESC: Partial<Record<SystemRole, string>> = {
  [SystemRole.BRANCH_MANAGER]: 'Shop Admin — every feature (sales, purchases, inventory, reports) for the assigned shop only.',
  [SystemRole.ACCOUNTANT]: 'Accounts & reports for the assigned shop.',
  [SystemRole.BILLER]: 'POS billing + today’s sales only — no profit/loss, reports or back-office.',
  [SystemRole.RECEPTIONIST]: 'Hotel front desk — check-in/out, guests, folio.',
  [SystemRole.HOUSEKEEPING]: 'Housekeeping tasks only.',
  [SystemRole.MAINTENANCE_STAFF]: 'Maintenance tasks only.',
};

export default function UsersPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const user = useAuthStore((s) => s.user);
  const { has } = usePermissions();
  const canSwitchBranches = has(Permission.BUSINESS_MANAGE);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: SystemRole.BILLER as string,
    branchId: user?.branchId ?? '',
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<UserRow[]>('/users', { token }),
  });

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api<BranchRow[]>('/branches', { token }),
  });

  const create = useMutation({
    mutationFn: () => api('/users', { method: 'POST', token, body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created');
      setForm({ email: '', password: '', firstName: '', lastName: '', role: SystemRole.BILLER as string, branchId: user?.branchId ?? '' });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      toast.error('First name, last name and email are required');
      return;
    }
    if (!isStrongPassword(form.password)) {
      toast.error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a letter and a number`);
      return;
    }
    create.mutate();
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Staff management</h1>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground">Access tiers</p>
        <p><span className="font-medium text-foreground">Super Admin</span> — everything, all shops &amp; hotels (set up at onboarding).</p>
        <p><span className="font-medium text-foreground">Manager</span> — every feature, but only for the shop assigned below.</p>
        <p><span className="font-medium text-foreground">Biller</span> — POS billing + today’s sales only.</p>
      </div>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add staff
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <PasswordInput placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <div className="space-y-1">
            <select
              className="h-10 w-full rounded-lg border px-3"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {ROLE_TIERS.map((tier) => {
                const roles = tier.roles.filter((r) => ASSIGNABLE_KEYS.has(r));
                if (!roles.length) return null;
                return (
                  <optgroup key={tier.label} label={tier.label}>
                    {roles.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {ROLE_DESC[form.role as SystemRole] && (
              <p className="text-xs text-muted-foreground">{ROLE_DESC[form.role as SystemRole]}</p>
            )}
          </div>
          {canSwitchBranches ? (
            <select
              className="h-10 rounded-lg border px-3"
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
            >
              <option value="">Select shop/branch...</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </select>
          ) : (
            <div className="h-10 rounded-lg border px-3 flex items-center text-sm text-muted-foreground bg-muted/30">
              {branches?.find((b) => b.id === user?.branchId)?.name ?? 'Your shop'} (staff are added to your own shop)
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Password must be at least {PASSWORD_MIN_LENGTH} characters and include a letter and a number.
        </p>
        <Button onClick={submit} disabled={!form.branchId || create.isPending}>Create user</Button>
      </Card>

      <div className="space-y-2">
        {users?.map((u) => (
          <Card key={u.id} className="p-4 flex justify-between items-center">
            <div>
              <p className="font-medium">{u.firstName} {u.lastName}</p>
              <p className="text-sm text-muted-foreground">{u.email}</p>
            </div>
            <span className="text-sm px-3 py-1 rounded-full bg-secondary">
              {ROLE_LABELS[u.role as SystemRole] ?? u.role}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}
