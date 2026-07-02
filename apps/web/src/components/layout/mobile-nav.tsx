'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, ShoppingBag, Users, Landmark, Package, MonitorSmartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MobileNav() {
  const pathname = usePathname();

  const items = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home', match: (p: string) => p === '/dashboard' },
    { href: '/sale/invoices', icon: FileText, label: 'Sale', match: (p: string) => p.startsWith('/sale') },
    { href: '/purchase/bills', icon: ShoppingBag, label: 'Purchase', match: (p: string) => p.startsWith('/purchase') },
    { href: '/parties', icon: Users, label: 'Parties', match: (p: string) => p.startsWith('/parties') },
    { href: '/pos', icon: MonitorSmartphone, label: 'POS', match: (p: string) => p.startsWith('/pos') },
    { href: '/items', icon: Package, label: 'Items', match: (p: string) => p.startsWith('/items') },
    { href: '/cash-bank', icon: Landmark, label: 'Cash', match: (p: string) => p.startsWith('/cash-bank') },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.06)] pb-safe">
      <div className="flex justify-around py-1.5 overflow-x-auto">
        {items.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link key={item.label} href={item.href} className={cn('flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-semibold min-w-[52px] shrink-0', active ? 'text-[hsl(348,85%,52%)]' : 'text-muted-foreground')}>
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
