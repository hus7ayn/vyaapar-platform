'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ROLE_LABELS, SystemRole } from '@nexus/shared';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
}

export default function UsersPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'RECEPTIONIST',
  });

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api<UserRow[]>('/users', { token }),
  });

  const create = useMutation({
    mutationFn: () => api('/users', { method: 'POST', token, body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created');
      setForm({ email: '', password: '', firstName: '', lastName: '', role: 'RECEPTIONIST' });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Staff management</h1>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add staff
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select
            className="h-10 rounded-lg border px-3 sm:col-span-2"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <Button onClick={() => create.mutate()}>Create user</Button>
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
