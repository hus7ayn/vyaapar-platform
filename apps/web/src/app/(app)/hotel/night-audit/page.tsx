'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Moon, Play } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Audit = {
  id: string;
  auditDate: string;
  roomsOccupied: number;
  totalRooms: number;
  roomRevenue: number | string;
  adr: number | string;
  revpar: number | string;
  occupancyRate: number | string;
};

export default function NightAuditPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState('');

  const { data: branches } = useQuery<any[]>({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<any[]>('/branches?type=HOTEL', { token }),
  });

  useEffect(() => {
    if (branches?.length && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const { data: audits, isLoading } = useQuery<Audit[]>({
    queryKey: ['night-audit', branchId],
    queryFn: () => api<Audit[]>(`/hotel/night-audit?branchId=${branchId}`, { token }),
    enabled: !!branchId,
  });

  const runAudit = useMutation({
    mutationFn: () => api(`/hotel/night-audit?branchId=${branchId}`, { method: 'POST', token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['night-audit'] });
      toast.success('Night audit completed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const latest = audits?.[0];

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Moon className="h-6 w-6" /> Night Audit</h1>
          <p className="text-sm text-muted-foreground">End-of-day room revenue, ADR, RevPAR & occupancy snapshot</p>
        </div>
        <div className="flex gap-2">
          <select className="border rounded-md px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <Button onClick={() => runAudit.mutate()} disabled={runAudit.isPending}>
            <Play className="h-4 w-4 mr-1" /> Run Tonight&apos;s Audit
          </Button>
        </div>
      </div>

      {latest && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4"><p className="text-sm text-muted-foreground">Occupancy</p><p className="text-2xl font-bold">{Number(latest.occupancyRate).toFixed(1)}%</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">ADR</p><p className="text-2xl font-bold">{formatCurrency(Number(latest.adr))}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">RevPAR</p><p className="text-2xl font-bold">{formatCurrency(Number(latest.revpar))}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Room Revenue</p><p className="text-2xl font-bold">{formatCurrency(Number(latest.roomRevenue))}</p></Card>
        </div>
      )}

      <div className="bg-white rounded-lg border divide-y">
        <h2 className="font-semibold p-4">Audit History</h2>
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading...</p>
        ) : !audits?.length ? (
          <p className="p-4 text-sm text-muted-foreground">No audits yet. Run your first night audit.</p>
        ) : (
          audits.map((a) => (
            <div key={a.id} className="p-4 flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-medium">{new Date(a.auditDate).toLocaleDateString()}</span>
              <span>{a.roomsOccupied}/{a.totalRooms} rooms · {Number(a.occupancyRate).toFixed(0)}% occ</span>
              <span>ADR {formatCurrency(Number(a.adr))} · RevPAR {formatCurrency(Number(a.revpar))}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
