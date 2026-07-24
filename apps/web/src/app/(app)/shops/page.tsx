'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Store } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Shop {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  type?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

interface ShopMetrics {
  todaysSales: number;
  todaysOrders: number;
  lowStockItems: number;
}

type EntityType = 'SHOP' | 'HOTEL';

export default function ShopsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const activeShopId = useAuthStore((s) => s.activeShopId);
  const setActiveShopId = useAuthStore((s) => s.setActiveShopId);

  const [createType, setCreateType] = useState<EntityType | null>(null);
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '' });

  const { data: shops, isLoading: shopsLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api<Shop[]>('/branches?type=SHOP', { token }),
    enabled: !!token,
  });

  const { data: hotels, isLoading: hotelsLoading } = useQuery({
    queryKey: ['hotels-entities'],
    queryFn: () => api<Shop[]>('/branches?type=HOTEL', { token }),
    enabled: !!token,
  });

  const openCreate = (type: EntityType) => {
    setForm({ name: '', code: '', address: '', phone: '' });
    setCreateType(type);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api<Shop>('/branches', {
        method: 'POST',
        token,
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          address: form.address || undefined,
          phone: form.phone || undefined,
          type: createType,
        }),
      }),
    onSuccess: (entity) => {
      const isHotel = createType === 'HOTEL';
      toast.success(`${isHotel ? 'Hotel' : 'Shop'} "${entity.name}" created`);
      setCreateType(null);
      queryClient.invalidateQueries();
      if (isHotel) {
        router.push('/hotel/dashboard');
      } else {
        setActiveShopId(entity.id);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 space-y-8 max-w-4xl">
      {/* Shops */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Store className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Shops
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Each shop has its own items, parties, stock, and transactions.
            </p>
          </div>
          <Button onClick={() => openCreate('SHOP')}>
            <Plus className="h-4 w-4 mr-1" /> Add Shop
          </Button>
        </div>

        <div className="grid gap-3">
          {shopsLoading && <p className="text-muted-foreground text-sm">Loading shops…</p>}
          {(shops ?? []).map((shop) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              token={token}
              active={shop.id === activeShopId}
              onSelect={() => {
                setActiveShopId(shop.id);
                toast.success(`Switched to ${shop.name}`);
                queryClient.invalidateQueries();
              }}
            />
          ))}
          {!shopsLoading && !(shops ?? []).length && (
            <p className="text-sm text-muted-foreground">No shops yet — add one.</p>
          )}
        </div>
      </section>

      {/* Hotels — kept separate; managed in Hotel PMS */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-[hsl(220,70%,45%)]" /> Hotels
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              A hotel is a separate entity — rooms, reservations, folios and its own Hotel PMS.
            </p>
          </div>
          <Button variant="outline" onClick={() => openCreate('HOTEL')}>
            <Plus className="h-4 w-4 mr-1" /> Add Hotel
          </Button>
        </div>

        <div className="grid gap-3">
          {hotelsLoading && <p className="text-muted-foreground text-sm">Loading hotels…</p>}
          {(hotels ?? []).map((hotel) => (
            <button
              key={hotel.id}
              type="button"
              onClick={() => router.push('/hotel/dashboard')}
              className="text-left w-full rounded-lg border p-4 bg-white shadow-sm transition-colors hover:border-[hsl(220,70%,45%)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{hotel.name}</p>
                  <p className="text-xs text-muted-foreground">{hotel.code}</p>
                  {hotel.address && <p className="text-xs text-muted-foreground mt-1">{hotel.address}</p>}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[hsl(220,70%,45%)] text-white">Hotel</span>
              </div>
              <p className="text-xs text-[hsl(220,70%,45%)] mt-2">Open in Hotel PMS →</p>
            </button>
          ))}
          {!hotelsLoading && !(hotels ?? []).length && (
            <p className="text-sm text-muted-foreground">No hotels yet — add one to start using the Hotel PMS.</p>
          )}
        </div>
      </section>

      <Dialog open={createType !== null} onOpenChange={(o) => !o && setCreateType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New {createType === 'HOTEL' ? 'Hotel' : 'Shop'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder={`${createType === 'HOTEL' ? 'Hotel' : 'Shop'} name`} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Code (e.g. BR02 / HTL1)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            <Input placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <Button
              className="w-full"
              disabled={!form.name.trim() || !form.code.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create {createType === 'HOTEL' ? 'Hotel' : 'Shop'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShopCard({
  shop,
  token,
  active,
  onSelect,
}: {
  shop: Shop;
  token?: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { data: metrics } = useQuery({
    queryKey: ['shop-metrics', shop.id],
    queryFn: () => api<ShopMetrics>(`/branches/${shop.id}/metrics`, { token, branchId: shop.id }),
    enabled: !!token,
  });

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left w-full rounded-lg border p-4 bg-white shadow-sm transition-colors hover:border-[hsl(348,85%,52%)] ${active ? 'ring-2 ring-[hsl(348,85%,52%)] border-[hsl(348,85%,52%)]' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{shop.name}</p>
          <p className="text-xs text-muted-foreground">{shop.code}{shop.isDefault ? ' · Default' : ''}</p>
          {shop.address && <p className="text-xs text-muted-foreground mt-1">{shop.address}</p>}
        </div>
        {active && <span className="text-xs px-2 py-0.5 rounded-full bg-[hsl(348,85%,52%)] text-white">Active</span>}
      </div>
      {metrics && (
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          <span>Today sales: ₹{metrics.todaysSales.toFixed(2)}</span>
          <span>Orders: {metrics.todaysOrders}</span>
          <span>Low stock: {metrics.lowStockItems}</span>
        </div>
      )}
    </button>
  );
}
