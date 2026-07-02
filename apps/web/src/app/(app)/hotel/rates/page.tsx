'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

type Category = { id: string; name: string; basePrice: number | string };
type RoomRate = { id: string; categoryId: string; rateDate: string; rate: number | string };

export default function RatesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [rate, setRate] = useState(0);

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);

  const { data: branches } = useQuery<any[]>({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<any[]>('/branches?type=HOTEL', { token }),
  });

  useEffect(() => {
    if (branches?.length && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const { data: categories } = useQuery<Category[]>({
    queryKey: ['room-categories', branchId],
    queryFn: () => api<Category[]>(`/hotel/room-categories?branchId=${branchId}`, { token }),
    enabled: !!branchId,
  });

  useEffect(() => {
    if (categories?.length && !categoryId) setCategoryId(categories[0].id);
  }, [categories, categoryId]);

  const { data: rates } = useQuery<RoomRate[]>({
    queryKey: ['room-rates', branchId],
    queryFn: () =>
      api<RoomRate[]>(
        `/hotel/room-rates?branchId=${branchId}&from=${monthStart.toISOString().slice(0, 10)}&to=${monthEnd.toISOString().slice(0, 10)}`,
        { token },
      ),
    enabled: !!branchId,
  });

  const setRoomRate = useMutation({
    mutationFn: () =>
      api(`/hotel/room-rates?branchId=${branchId}`, {
        method: 'POST',
        token,
        body: JSON.stringify({ categoryId, rateDate, rate }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['room-rates'] });
      toast.success('Rate updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="h-6 w-6" /> Rate Management</h1>
        <p className="text-sm text-muted-foreground">Set daily rates by room category</p>
      </div>

      <Card className="p-4 space-y-4 max-w-lg">
        <select className="w-full border rounded-md px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="w-full border rounded-md px-3 py-2 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name} (base {formatCurrency(Number(c.basePrice))})</option>)}
        </select>
        <Input type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
        <Input type="number" placeholder="Rate per night" value={rate || ''} onChange={(e) => setRate(Number(e.target.value))} />
        <Button className="w-full" disabled={!categoryId || !rate || setRoomRate.isPending} onClick={() => setRoomRate.mutate()}>
          Set Rate
        </Button>
      </Card>

      <div className="bg-white rounded-lg border divide-y">
        <h2 className="font-semibold p-4">Rates this month</h2>
        {!rates?.length ? (
          <p className="p-4 text-sm text-muted-foreground">No custom rates set — using base prices</p>
        ) : (
          rates.map((r) => {
            const cat = categories?.find((c) => c.id === r.categoryId);
            return (
              <div key={r.id} className="p-3 flex justify-between text-sm">
                <span>{cat?.name ?? 'Category'} · {new Date(r.rateDate).toLocaleDateString()}</span>
                <span className="font-semibold">{formatCurrency(Number(r.rate))}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
