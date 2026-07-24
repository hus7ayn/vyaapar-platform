'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Category {
  id: string;
  name: string;
  slug: string;
  branchId?: string | null;
}

interface Branch {
  id: string;
  name: string;
}

// Common hotel F&B / service item categories, offered as one-tap presets.
const SUGGESTED = ['Food', 'Beverages', 'Snacks', 'Desserts', 'Room Service'];

export default function HotelCategoriesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [name, setName] = useState('');

  const { data: branches } = useQuery({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<Branch[]>('/branches?type=HOTEL', { token }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (branches && branches.length > 0 && !selectedBranchId) setSelectedBranchId(branches[0].id);
  }, [branches, selectedBranchId]);

  const { data: categories } = useQuery({
    queryKey: ['hotel-categories', selectedBranchId],
    queryFn: () => api<Category[]>(`/categories?branchId=${selectedBranchId}`, { token }),
    enabled: !!selectedBranchId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['hotel-categories', selectedBranchId] });

  const addMutation = useMutation({
    mutationFn: (categoryName: string) =>
      api<Category>('/categories', {
        method: 'POST',
        token,
        body: JSON.stringify({ name: categoryName, branchId: selectedBranchId }),
      }),
    onSuccess: () => { invalidate(); setName(''); toast.success('Category added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: 'DELETE', token }),
    onSuccess: () => { invalidate(); toast.success('Category removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const existingNames = new Set((categories ?? []).map((c) => c.name.toLowerCase()));

  const add = (categoryName: string) => {
    const n = categoryName.trim();
    if (!n) return;
    if (existingNames.has(n.toLowerCase())) { toast.error('That category already exists'); return; }
    if (!selectedBranchId) { toast.error('Select a hotel property first'); return; }
    addMutation.mutate(n);
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="h-6 w-6 text-[hsl(220,70%,45%)]" /> Item Categories
        </h1>
        <p className="text-sm text-muted-foreground">
          Organise hotel items (Food, Beverages, Snacks, Desserts, Room Service, …) into categories.
        </p>
      </div>

      {(branches?.length ?? 0) > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Property:</span>
          <select
            className="h-10 rounded-lg border px-3 text-sm bg-white"
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); add(name); }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name (e.g. Beverages)" />
          <Button type="submit" disabled={addMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </form>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Quick add</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.filter((s) => !existingNames.has(s.toLowerCase())).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="rounded-full border border-dashed border-[hsl(220,70%,45%)]/40 px-3 py-1 text-xs font-medium text-[hsl(220,70%,45%)] hover:bg-[hsl(220,70%,45%)]/5"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white divide-y">
        {(categories ?? []).map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">{c.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => { if (confirm(`Remove category "${c.name}"?`)) removeMutation.mutate(c.id); }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {!(categories ?? []).length && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No categories yet — add one above.</p>
        )}
      </div>
    </div>
  );
}
