'use client';

import { use } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone?: string;
  gstNumber?: string;
  isActive: boolean;
  createdAt: string;
  branches: Array<{ id: string; name: string; code: string }>;
  users: Array<{ id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean }>;
  _count: { orders: number; products: number; rooms: number };
}

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['platform-tenant', id],
    queryFn: () => api<TenantDetail>(`/platform/tenants/${id}`, { token }),
  });

  const toggleActive = useMutation({
    mutationFn: (isActive: boolean) =>
      api(`/platform/tenants/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-tenant', id] });
      qc.invalidateQueries({ queryKey: ['platform-tenants'] });
      toast.success('Tenant updated');
    },
  });

  if (!data) return <p className="p-6 text-muted-foreground">Loading...</p>;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <Link href="/platform/tenants" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to tenants
      </Link>

      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-muted-foreground">{data.email}</p>
          <p className="text-xs text-muted-foreground mt-1">{data.slug}</p>
        </div>
        <Button
          variant={data.isActive ? 'destructive' : 'default'}
          onClick={() => toggleActive.mutate(!data.isActive)}
        >
          {data.isActive ? 'Suspend tenant' : 'Activate tenant'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{data._count.orders}</p>
          <p className="text-sm text-muted-foreground">Orders</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{data._count.products}</p>
          <p className="text-sm text-muted-foreground">Products</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-2xl font-bold">{data._count.rooms}</p>
          <p className="text-sm text-muted-foreground">Rooms</p>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="font-semibold mb-3">Branches</h2>
        <ul className="space-y-2">
          {data.branches.map((b) => (
            <li key={b.id} className="text-sm">
              {b.name} <span className="text-muted-foreground">({b.code})</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold mb-3">Users</h2>
        <ul className="space-y-2">
          {data.users.map((u) => (
            <li key={u.id} className="flex justify-between text-sm">
              <span>
                {u.firstName} {u.lastName} — {u.email}
              </span>
              <span className="text-muted-foreground">{u.role}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
