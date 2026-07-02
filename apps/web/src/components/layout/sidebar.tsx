'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  ShoppingBag,
  Users,
  Package,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  Building2,
  ChevronDown,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  Bell,
  Wrench,
  MonitorSmartphone,
  Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { APP_NAME } from '@nexus/shared';
import { ShopSwitcher } from '@/components/layout/shop-switcher';

interface NavLeaf {
  href: string;
  label: string;
}

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  match?: (pathname: string) => boolean;
  children?: NavLeaf[];
}

const NAV: NavItem[] = [
  { label: 'Home', icon: LayoutDashboard, href: '/dashboard', match: (p) => p === '/dashboard' },
  { label: 'Parties', icon: Users, href: '/parties', match: (p) => p.startsWith('/parties') },
  { label: 'Items', icon: Package, href: '/items', match: (p) => p.startsWith('/items') },
  {
    label: 'Sale', icon: FileText, match: (p) => p.startsWith('/sale'),
    children: [
      { href: '/sale/invoices', label: 'Sale Invoices' },
      { href: '/sale/estimates', label: 'Estimate / Quotation' },
      { href: '/sale/payment-in', label: 'Payment In' },
      { href: '/sale/orders', label: 'Sale Order' },
      { href: '/sale/challans', label: 'Delivery Challan' },
      { href: '/sale/credit-notes', label: 'Sale Return / Credit Note' },
    ],
  },
  {
    label: 'Purchase', icon: ShoppingBag, match: (p) => p.startsWith('/purchase'),
    children: [
      { href: '/purchase/bills', label: 'Purchase Bills' },
      { href: '/purchase/payment-out', label: 'Payment Out' },
      { href: '/purchase/orders', label: 'Purchase Order' },
      { href: '/purchase/debit-notes', label: 'Purchase Return / Debit Note' },
    ],
  },
  { label: 'Expenses', icon: Wallet, href: '/expenses', match: (p) => p.startsWith('/expenses') },
  {
    label: 'Cash & Bank', icon: Landmark, match: (p) => p.startsWith('/cash-bank'),
    children: [
      { href: '/cash-bank', label: 'Bank Accounts' },
      { href: '/cash-bank/cheques', label: 'Cheques' },
      { href: '/cash-bank/loans', label: 'Loan Accounts' },
    ],
  },
  { label: 'Vyapar POS', icon: MonitorSmartphone, href: '/pos', match: (p) => p.startsWith('/pos') },
  { label: 'Reports', icon: BarChart3, href: '/reports', match: (p) => p.startsWith('/reports') },
  { label: 'Reminders', icon: Bell, href: '/reminders', match: (p) => p.startsWith('/reminders') },
  { label: 'Utilities', icon: Wrench, href: '/utilities', match: (p) => p.startsWith('/utilities') },
];

const MORE_NAV: NavItem[] = [
  { label: 'Shops', icon: Building2, href: '/shops', match: (p) => p.startsWith('/shops') },
  { label: 'Hotel PMS', icon: Building2, href: '/hotel/dashboard', match: (p) => p.startsWith('/hotel') || p.startsWith('/housekeeping') || p.startsWith('/services') },
  { label: 'Payroll / HR', icon: Briefcase, href: '/payroll', match: (p) => p.startsWith('/payroll') },
  { label: 'Settings', icon: Settings, href: '/settings', match: (p) => p.startsWith('/settings') },
];

const QUICK_ACTIONS = [
  { href: '/sale/invoices/new', label: 'Add Sale', icon: FileText, color: 'bg-[hsl(348,85%,52%)]' },
  { href: '/purchase/bills/new', label: 'Add Purchase', icon: ShoppingBag, color: 'bg-[hsl(210,90%,50%)]' },
  { href: '/sale/payment-in/new', label: 'Pay In', icon: ArrowDownLeft, color: 'bg-[hsl(142,71%,45%)]' },
  { href: '/purchase/payment-out/new', label: 'Pay Out', icon: ArrowUpRight, color: 'bg-[hsl(25,95%,53%)]' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [expanded, setExpanded] = useState<string | null>(() => {
    if (pathname.startsWith('/sale')) return 'Sale';
    if (pathname.startsWith('/purchase')) return 'Purchase';
    if (pathname.startsWith('/cash-bank')) return 'Cash & Bank';
    return null;
  });

  const renderItem = (item: NavItem, muted = false) => {
    const Icon = item.icon;
    const active = item.match ? item.match(pathname) : pathname === item.href;

    if (item.children) {
      const isOpen = expanded === item.label || active;
      return (
        <div key={item.label}>
          <button
            type="button"
            onClick={() => setExpanded(isOpen && expanded === item.label ? null : item.label)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'text-[hsl(348,85%,52%)] bg-[hsl(348,30%,96%)]' : 'text-foreground/80 hover:bg-[hsl(348,30%,96%)]',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
            <ChevronDown className={cn('h-3.5 w-3.5 ml-auto transition-transform', isOpen ? '' : '-rotate-90')} />
          </button>
          {isOpen && (
            <div className="ml-7 border-l pl-2 space-y-0.5 py-0.5">
              {item.children.map((c) => {
                const childActive = pathname === c.href || pathname.startsWith(`${c.href}/`);
                return (
                  <Link
                    key={c.href}
                    href={c.href}
                    className={cn(
                      'block rounded-md px-2 py-1.5 text-[13px] transition-colors',
                      childActive ? 'bg-[hsl(348,85%,52%)] text-white font-medium' : 'text-muted-foreground hover:bg-[hsl(348,30%,96%)] hover:text-foreground',
                    )}
                  >
                    {c.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={item.label}
        href={item.href!}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          active
            ? 'bg-[hsl(348,85%,52%)] text-white shadow-sm'
            : muted
              ? 'text-muted-foreground hover:bg-[hsl(348,30%,96%)]'
              : 'text-foreground/80 hover:bg-[hsl(348,30%,96%)]',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {item.label}
        {muted && <ChevronRight className="h-3 w-3 ml-auto opacity-40" />}
      </Link>
    );
  };

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r bg-white h-screen sticky top-0 shadow-sm">
      <div className="p-4 border-b bg-[hsl(348,85%,52%)]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-white flex items-center justify-center text-[hsl(348,85%,52%)] font-extrabold text-lg shadow">V</div>
          <div>
            <p className="font-bold text-white text-base">{APP_NAME}</p>
            <p className="text-xs text-white/80 truncate max-w-[150px]">{user?.email}</p>
          </div>
        </div>
      </div>

      <ShopSwitcher />

      <div className="p-3 grid grid-cols-2 gap-2 border-b bg-[hsl(348,30%,97%)]">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.label} href={action.href} className="flex flex-col items-center gap-1 rounded-lg p-2 hover:bg-white transition-colors group">
              <div className={cn('h-9 w-9 rounded-full flex items-center justify-center text-white shadow-sm', action.color)}>
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground group-hover:text-foreground">{action.label}</span>
            </Link>
          );
        })}
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => renderItem(item))}

        <div className="pt-3 pb-1 px-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">More</span>
        </div>
        {MORE_NAV.map((item) => renderItem(item, true))}
      </nav>

      <div className="p-2 border-t">
        <button
          type="button"
          onClick={() => { logout(); window.location.href = '/login'; }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
