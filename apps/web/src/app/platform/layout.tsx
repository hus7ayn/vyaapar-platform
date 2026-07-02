'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SystemRole } from '@nexus/shared';
import { PlatformSidebar } from '@/components/platform/platform-sidebar';
import { useAuthStore } from '@/stores/auth-store';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const role = useAuthStore((s) => s.user?.role);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      if (!accessToken) router.replace('/login');
      else if (role && role !== SystemRole.SUPER_ADMIN) router.replace('/dashboard');
    }
  }, [mounted, accessToken, role, router]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!accessToken || role !== SystemRole.SUPER_ADMIN) return null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <PlatformSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
