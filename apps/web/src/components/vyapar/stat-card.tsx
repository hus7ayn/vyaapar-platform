'use client';

import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
}

export function VyaparStatCard({ label, value, color = 'border-l-[hsl(348,85%,52%)]', icon }: StatCardProps) {
  return (
    <div className={cn('bg-white rounded-lg border border-l-4 shadow-sm p-4', color)}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
