'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Card } from '@/components/ui/card';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  createdAt: string;
  business: { name: string; slug: string };
  user?: { email: string; firstName: string; lastName: string };
}

export default function PlatformAuditPage() {
  const token = useAuthStore((s) => s.accessToken)!;

  const { data, isLoading } = useQuery({
    queryKey: ['platform-audit'],
    queryFn: () => api<{ data: AuditEntry[] }>('/platform/audit-logs?limit=100', { token }),
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform audit logs</h1>
        <p className="text-muted-foreground">Cross-tenant activity trail</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <Card className="divide-y">
          {data?.data.map((log) => (
            <div key={log.id} className="p-4 flex flex-col sm:flex-row sm:justify-between gap-2">
              <div>
                <p className="font-medium">
                  {log.action} · {log.entity}
                </p>
                <p className="text-sm text-muted-foreground">
                  {log.business.name}
                  {log.user && ` — ${log.user.firstName} ${log.user.lastName}`}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(log.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
