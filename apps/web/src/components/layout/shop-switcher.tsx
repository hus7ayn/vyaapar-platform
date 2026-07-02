'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

interface ShopBranch {
  id: string;
  name: string;
  code: string;
  isDefault?: boolean;
}

export function ShopSwitcher() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const activeShopId = useAuthStore((s) => s.activeShopId);
  const setActiveShopId = useAuthStore((s) => s.setActiveShopId);

  const { data: shops } = useQuery({
    queryKey: ['shops'],
    queryFn: () => api<ShopBranch[]>('/branches?type=SHOP', { token }),
    enabled: !!token,
  });

  useEffect(() => {
    if (!shops?.length) return;
    if (!activeShopId || !shops.some((s) => s.id === activeShopId)) {
      const defaultShop = shops.find((s) => s.isDefault) ?? shops[0];
      setActiveShopId(defaultShop.id);
    }
  }, [shops, activeShopId, setActiveShopId]);

  const activeShop = shops?.find((s) => s.id === activeShopId);

  const onSwitch = (id: string) => {
    setActiveShopId(id);
    queryClient.invalidateQueries();
  };

  return (
    <div className="px-3 py-2 border-b bg-[hsl(348,30%,97%)]">
      <div className="flex items-center gap-2">
        <Store className="h-4 w-4 text-[hsl(348,85%,52%)] shrink-0" />
        <div className="relative flex-1 min-w-0">
          <select
            value={activeShopId ?? ''}
            onChange={(e) => onSwitch(e.target.value)}
            className={cn(
              'w-full appearance-none rounded-md border bg-white px-2.5 py-1.5 pr-7 text-sm font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(348,85%,52%)]',
            )}
          >
            {(shops ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        <Link
          href="/shops"
          className="shrink-0 rounded-md border bg-white p-1.5 text-muted-foreground hover:text-[hsl(348,85%,52%)] hover:border-[hsl(348,85%,52%)]"
          title="Manage shops"
        >
          <Plus className="h-4 w-4" />
        </Link>
      </div>
      {activeShop && (
        <p className="text-[10px] text-muted-foreground mt-1 pl-6 truncate">
          Shop {activeShop.code} — all data (items, parties, cash, sales) is separate
        </p>
      )}
    </div>
  );
}
