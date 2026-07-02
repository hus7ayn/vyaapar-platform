'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, BedDouble, UserPlus, Users, Layers, DollarSign,
  Sparkles, Moon, BarChart3, Wallet, Wrench, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

const tabs = [
  { name: 'Dashboard', href: '/hotel/dashboard', icon: LayoutDashboard },
  { name: 'Front Desk', href: '/hotel', icon: BedDouble, match: (p: string) => p === '/hotel' },
  { name: 'Check-in', href: '/hotel/check-in', icon: UserPlus },
  { name: 'Guests', href: '/hotel/guests', icon: Users },
  { name: 'Room Types', href: '/hotel/room-types', icon: Layers },
  { name: 'Rates', href: '/hotel/rates', icon: DollarSign },
  { name: 'Housekeeping', href: '/housekeeping', icon: Sparkles },
  { name: 'Night Audit', href: '/hotel/night-audit', icon: Moon },
  { name: 'Maintenance', href: '/hotel/maintenance', icon: Wrench },
  { name: 'Reports', href: '/hotel/reports', icon: BarChart3 },
  { name: 'Expenses', href: '/hotel/expenses', icon: Wallet },
];

export default function HotelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (tab: (typeof tabs)[number]) =>
    tab.match ? tab.match(pathname) : pathname === tab.href || pathname.startsWith(tab.href + '/');

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      <div className="border-b bg-white shadow-sm">
        <div className="flex items-center gap-3 px-3 h-12">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')} className="shrink-0 h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-bold text-sm text-[hsl(220,70%,45%)]">Hotel PMS</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto px-2 pb-0 scrollbar-hide">
          {tabs.map((tab) => {
            const active = isActive(tab);
            return (
              <Link
                key={tab.name}
                href={tab.href}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-semibold px-3 py-2 border-b-2 transition-colors whitespace-nowrap',
                  active
                    ? 'border-[hsl(220,70%,45%)] text-[hsl(220,70%,45%)]'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.name}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
