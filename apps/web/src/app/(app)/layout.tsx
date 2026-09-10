'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { TopBar } from '@/components/layout/top-bar';
import { ConnectionBanner } from '@/components/connection-banner';
import { DesktopAppBanner } from '@/components/desktop-app-banner';
import { useAuthStore } from '@/stores/auth-store';
import { startSyncInterval } from '@/lib/sync-manager';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  const role = useAuthStore((s) => s.user?.role);
  const [mounted, setMounted] = useState(false);
  const syncClientId = useRef(typeof crypto !== 'undefined' ? crypto.randomUUID() : 'client');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Flush any queued offline sales from ANY page (not just POS) whenever the server is
  // reachable, so pending sales don't sit as "waiting to sync" after leaving the POS.
  useEffect(() => {
    if (!accessToken) return;
    return startSyncInterval(accessToken, syncClientId.current);
  }, [accessToken]);

  useEffect(() => {
    if (mounted && !accessToken) {
      router.replace('/login');
    }
  }, [mounted, accessToken, router]);

  // Biller lockdown: Biller is confined to the POS (billing) area. They can bill there but must
  // not reach reports/P&L, inventory, settings, etc. (Admins and owners are unaffected; their
  // access is scoped server-side.)
  useEffect(() => {
    if (!mounted || !accessToken) return;
    // Biller may use POS plus their own sales reports and sales invoices/returns.
    const billerShopAllowed = ['/pos', '/reports', '/sale'];
    if (role === 'BILLER' && !billerShopAllowed.some((p) => pathname.startsWith(p))) {
      router.replace('/pos');
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
    <div className="flex min-h-screen w-full">
      <Sidebar />
      {/* min-w-0 keeps a wide table inside a page from stretching this column past the
          viewport — the overflow then stays inside <main> (or the table's own
          overflow-x-auto wrapper) instead of scrolling the whole page sideways. */}
      <div className="flex-1 flex flex-col min-w-0 max-w-full">
        <DesktopAppBanner />
        <ConnectionBanner />
        <TopBar />
        <main className="flex-1 min-w-0 overflow-auto pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
