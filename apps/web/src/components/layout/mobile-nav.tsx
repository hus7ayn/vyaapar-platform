'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, ShoppingBag, Users, Landmark, Package, MonitorSmartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Permission } from '@nexus/shared';
import { usePermissions } from '@/hooks/use-permissions';
import { useAuthStore } from '@/stores/auth-store';

export function MobileNav() {
  const pathname = usePathname();
  const { has } = usePermissions();
  const role = useAuthStore((s) => s.user?.role);

  const items = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home', match: (p: string) => p === '/dashboard', hideForRoles: ['BILLER'] },
    { href: '/sale/invoices', icon: FileText, label: 'Sale', match: (p: string) => p.startsWith('/sale'), permission: Permission.POS_SELL, hideForRoles: ['BILLER'] },
    { href: '/purchase/bills', icon: ShoppingBag, label: 'Purchase', match: (p: string) => p.startsWith('/purchase'), permission: Permission.INVENTORY_VIEW },
    { href: '/parties', icon: Users, label: 'Parties', match: (p: string) => p.startsWith('/parties'), permission: Permission.POS_SELL, hideForRoles: ['BILLER'] },
    { href: '/pos', icon: MonitorSmartphone, label: 'POS', match: (p: string) => p.startsWith('/pos'), permission: Permission.POS_SELL },
    { href: '/items', icon: Package, label: 'Items', match: (p: string) => p.startsWith('/items'), permission: Permission.INVENTORY_VIEW },
    { href: '/cash-bank', icon: Landmark, label: 'Cash', match: (p: string) => p.startsWith('/cash-bank'), permission: Permission.REPORTS_VIEW },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.06)] pb-safe">
      <div className="flex justify-around py-1.5 overflow-x-auto">
        {items.filter((item) => (!item.permission || has(item.permission)) && !(role && item.hideForRoles?.includes(role))).map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link key={item.label} href={item.href} className={cn('flex flex-col items-center gap-0.5 px-1.5 py-1 text-[10px] font-semibold min-w-[44px] shrink-0', active ? 'text-[hsl(348,85%,52%)]' : 'text-muted-foreground')}>
              <div className={cn('p-1 rounded-lg', active && 'bg-[hsl(348,85%,96%)]')}>
                <Icon className="h-5 w-5" />
              </div>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
