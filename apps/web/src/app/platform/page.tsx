'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Building2, Users, ShoppingCart, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface PlatformStats {
  tenants: number;
  activeTenants: number;
  users: number;
  orders: number;
  recentTenants: Array<{
    id: string;
    name: string;
    slug: string;
    email: string;
    isActive: boolean;
    createdAt: string;
    _count: { users: number; orders: number };
  }>;
}

export default function PlatformDashboardPage() {
  const token = useAuthStore((s) => s.accessToken)!;

  const { data } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => api<PlatformStats>('/platform/stats', { token }),
  });

  const stats = [
    { label: 'Total tenants', value: data?.tenants ?? 0, icon: Building2 },
    { label: 'Active tenants', value: data?.activeTenants ?? 0, icon: CheckCircle2 },
    { label: 'Users', value: data?.users ?? 0, icon: Users },
    { label: 'Orders', value: data?.orders ?? 0, icon: ShoppingCart },
  ];

  return (
    <div className="p-6 space-y-8">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform overview</h1>
          <p className="text-slate-500">Multi-tenant SaaS control plane</p>
        </div>
        <Link href="/platform/tenants?create=1">
          <Button>Provision tenant</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-3xl font-bold mt-1">{value}</p>
              </div>
              <Icon className="h-8 w-8 text-indigo-500 opacity-80" />
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-lg">Recent tenants</h2>
          <Link href="/platform/tenants" className="text-sm text-indigo-600 hover:underline">
            View all
          </Link>
        </div>
        <div className="space-y-3">
          {data?.recentTenants.map((t) => (
            <Link
              key={t.id}
              href={`/platform/tenants/${t.id}`}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-slate-50 transition-colors"
            >
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-sm text-muted-foreground">{t.email}</p>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p>{t._count.users} users · {t._count.orders} orders</p>
                <span
                  className={
                    t.isActive ? 'text-emerald-600' : 'text-amber-600'
                  }
                >
                  {t.isActive ? 'Active' : 'Suspended'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
