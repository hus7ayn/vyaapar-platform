'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, LayoutDashboard, ScrollText, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';

const links = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/tenants', label: 'Tenants', icon: Building2 },
  { href: '/platform/audit', label: 'Audit logs', icon: ScrollText },
];

export function PlatformSidebar() {
  const pathname = usePathname();
  const logout = useAuthStore((s) => s.logout);

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r bg-slate-950 text-slate-100">
      <div className="p-6 border-b border-slate-800">
        <p className="text-xs uppercase tracking-wider text-slate-400">MSW Global</p>
        <p className="font-bold text-lg">Platform Console</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              pathname === href || (href !== '/platform' && pathname.startsWith(href))
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-800',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <Button
          variant="ghost"
          className="w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800"
          onClick={() => {
            logout();
            window.location.href = '/login';
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
