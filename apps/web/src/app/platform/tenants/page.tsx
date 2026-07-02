'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  _count: { users: number; orders: number; products: number };
}

export default function PlatformTenantsPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    adminEmail: '',
    adminPassword: '',
    adminFirstName: '',
    adminLastName: '',
    phone: '',
  });

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true);
  }, [searchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-tenants', search],
    queryFn: () =>
      api<{ data: Tenant[] }>(`/platform/tenants?limit=50&search=${encodeURIComponent(search)}`, { token }),
  });

  const createTenant = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/platform/tenants', { method: 'POST', token, body: JSON.stringify(form) }),
    onSuccess: (tenant) => {
      qc.invalidateQueries({ queryKey: ['platform-tenants'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      toast.success('Tenant provisioned');
      setCreateOpen(false);
      router.push(`/platform/tenants/${tenant.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tenants</h1>
          <p className="text-muted-foreground">Manage businesses on the platform</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New tenant
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search tenants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid gap-3">
          {data?.data.map((t) => (
            <Link key={t.id} href={`/platform/tenants/${t.id}`}>
              <Card className="p-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-sm text-muted-foreground">{t.email}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t.slug}</p>
                  </div>
                  <div className="text-right text-sm">
                    <span className={t.isActive ? 'text-emerald-600' : 'text-amber-600'}>
                      {t.isActive ? 'Active' : 'Suspended'}
                    </span>
                    <p className="text-muted-foreground mt-1">
                      {t._count.users} users · {t._count.products} products
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Provision new tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Business name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Admin email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
            <Input placeholder="Admin password" type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="First name" value={form.adminFirstName} onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })} />
              <Input placeholder="Last name" value={form.adminLastName} onChange={(e) => setForm({ ...form, adminLastName: e.target.value })} />
            </div>
            <Button className="w-full" onClick={() => createTenant.mutate()} disabled={createTenant.isPending}>
              Create tenant
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
