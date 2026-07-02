'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';

type Category = {
  id: string;
  name: string;
  description?: string;
  basePrice: number | string;
  maxGuests: number;
  amenities: string[];
};

export default function RoomTypesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', basePrice: 0, maxGuests: 2 });

  const { data: branches } = useQuery<any[]>({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<any[]>('/branches?type=HOTEL', { token }),
  });

  useEffect(() => {
    if (branches?.length && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const { data: categories, isLoading } = useQuery<Category[]>({
    queryKey: ['room-categories', branchId],
    queryFn: () => api<Category[]>(`/hotel/room-categories?branchId=${branchId}`, { token }),
    enabled: !!branchId,
  });

  const createCategory = useMutation({
    mutationFn: () =>
      api(`/hotel/room-categories?branchId=${branchId}`, {
        method: 'POST',
        token,
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-categories'] });
      toast.success('Room type created');
      setShowCreate(false);
      setForm({ name: '', description: '', basePrice: 0, maxGuests: 2 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="h-6 w-6" /> Room Types</h1>
          <p className="text-sm text-muted-foreground">Manage room categories, base rates & amenities</p>
        </div>
        <div className="flex gap-2">
          <select className="border rounded-md px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" /> Add Type</Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : !categories?.length ? (
          <p className="text-muted-foreground">No room types yet</p>
        ) : (
          categories.map((cat) => (
            <Card key={cat.id} className="p-4 space-y-2">
              <h3 className="font-semibold text-lg">{cat.name}</h3>
              {cat.description && <p className="text-sm text-muted-foreground">{cat.description}</p>}
              <p className="text-xl font-bold text-[hsl(220,70%,45%)]">{formatCurrency(Number(cat.basePrice))}/night</p>
              <p className="text-xs text-muted-foreground">Max guests: {cat.maxGuests}</p>
              {cat.amenities?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {cat.amenities.map((a) => (
                    <span key={a} className="text-xs bg-muted px-2 py-0.5 rounded">{a}</span>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Room Type</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Name (e.g. Deluxe)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Input type="number" placeholder="Base price/night" value={form.basePrice || ''} onChange={(e) => setForm({ ...form, basePrice: Number(e.target.value) })} />
            <Input type="number" placeholder="Max guests" value={form.maxGuests} onChange={(e) => setForm({ ...form, maxGuests: Number(e.target.value) })} />
            <Button className="w-full" disabled={!form.name || createCategory.isPending} onClick={() => createCategory.mutate()}>
              Create Room Type
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
