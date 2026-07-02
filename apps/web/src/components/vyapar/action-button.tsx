'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActionButtonProps {
  href?: string;
  onClick?: () => void;
  label: string;
  color?: string;
}

export function VyaparActionButton({ href, onClick, label, color = 'bg-[hsl(348,85%,52%)]' }: ActionButtonProps) {
  const className = cn(
    'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity',
    color,
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        <Plus className="h-4 w-4" />
        {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}
