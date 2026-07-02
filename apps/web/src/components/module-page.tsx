'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Card } from '@/components/ui/card';

interface ModulePageProps {
  title: string;
  description: string;
  endpoint: string;
  renderItem?: (item: Record<string, unknown>) => React.ReactNode;
}

export function ModulePage({ title, description, endpoint, renderItem }: ModulePageProps) {
  const token = useAuthStore((s) => s.accessToken)!;

  const { data, isLoading } = useQuery({
    queryKey: [endpoint],
    queryFn: async () => {
      const res = await api<unknown>(endpoint, { token });
      if (res && typeof res === 'object' && 'data' in res) return (res as { data: unknown[] }).data;
      return Array.isArray(res) ? res : [res];
    },
  });

  const items = (data ?? []) as Record<string, unknown>[];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No records yet</Card>
      ) : (
        <div className="grid gap-3">
          {items.map((item, i) => (
            <Card key={(item.id as string) ?? i} className="p-4">
              {renderItem ? renderItem(item) : <pre className="text-xs overflow-auto">{JSON.stringify(item, null, 2)}</pre>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
