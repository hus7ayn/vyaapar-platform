'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { TopBar } from '@/components/layout/top-bar';
import { ConnectionBanner } from '@/components/connection-banner';
import { DesktopAppBanner } from '@/components/desktop-app-banner';
import { useAuthStore } from '@/stores/auth-store';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  const role = useAuthStore((s) => s.user?.role);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !accessToken) {
      router.replace('/login');
    }
  }, [mounted, accessToken, router]);

  // Biller lockdown: Biller (Shop) is confined to the POS (billing) area; Biller (Hotel) is
  // confined to the hotel module. They can bill there but must not reach reports/P&L, inventory,
  // settings, etc. (Admins and owners are unaffected; their access is scoped server-side.)
  useEffect(() => {
    if (!mounted || !accessToken) return;
    // Biller (Shop) may use POS plus their own sales reports and sales invoices/returns.
    const billerShopAllowed = ['/pos', '/reports', '/sale'];
    if (role === 'BILLER' && !billerShopAllowed.some((p) => pathname.startsWith(p))) {
      router.replace('/pos');
    } else if (role === 'BILLER_HOTEL' && !pathname.startsWith('/hotel')) {
      router.replace('/hotel');
    }
  }, [mounted, accessToken, role, pathname, router]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!accessToken) return null;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DesktopAppBanner />
        <ConnectionBanner />
        <TopBar />
        <main className="flex-1 overflow-auto pb-20 lg:pb-0">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
