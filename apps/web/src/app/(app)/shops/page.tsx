'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Store } from 'lucide-react';
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
  isDefault?: boolean;
  isActive?: boolean;
}

interface ShopMetrics {
  todaysSales: number;
  todaysOrders: number;
  lowStockItems: number;
}

export default function ShopsPage() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const activeShopId = useAuthStore((s) => s.activeShopId);
  const setActiveShopId = useAuthStore((s) => s.setActiveShopId);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '' });

  const { data: shops, isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api<Shop[]>('/branches?type=SHOP', { token }),
    enabled: !!token,
  });

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
          type: 'SHOP',
        }),
      }),
    onSuccess: (shop) => {
      toast.success(`Shop "${shop.name}" created`);
      setOpen(false);
      setForm({ name: '', code: '', address: '', phone: '' });
      setActiveShopId(shop.id);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Store className="h-5 w-5 text-[hsl(348,85%,52%)]" /> Shops
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Each shop has its own items, parties, stock, and transactions.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Shop
        </Button>
      </div>

      <div className="grid gap-3">
        {isLoading && <p className="text-muted-foreground text-sm">Loading shops…</p>}
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
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Shop</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Shop name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Code (e.g. BR02)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            <Input placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <Button
              className="w-full"
              disabled={!form.name.trim() || !form.code.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create Shop
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
