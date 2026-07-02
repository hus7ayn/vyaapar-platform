'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { Card } from '@/components/ui/card';

type Metrics = {
  adr: number;
  revpar: number;
  occupancyRate: number;
  roomRevenue: number;
  roomNights: number;
  totalRooms: number;
  occupied: number;
  auditHistory: { auditDate: string; adr: number | string; revpar: number | string; occupancyRate: number | string; roomRevenue: number | string }[];
};

export default function HotelReportsPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const [branchId, setBranchId] = useState('');

  const { data: branches } = useQuery<any[]>({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<any[]>('/branches?type=HOTEL', { token }),
  });

  useEffect(() => {
    if (branches?.length && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const { data: metrics, isLoading } = useQuery<Metrics>({
    queryKey: ['revenue-metrics', branchId],
    queryFn: () => api<Metrics>(`/hotel/revenue-metrics?branchId=${branchId}`, { token }),
    enabled: !!branchId,
  });

  const chartData = (metrics?.auditHistory ?? []).map((a) => ({
    date: new Date(a.auditDate).toLocaleDateString('en', { weekday: 'short' }),
    adr: Number(a.adr),
    revpar: Number(a.revpar),
    occupancy: Number(a.occupancyRate),
    revenue: Number(a.roomRevenue),
  })).reverse();

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Hotel Reports</h1>
          <p className="text-sm text-muted-foreground">ADR, RevPAR, occupancy & revenue analytics</p>
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : metrics ? (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4"><p className="text-sm text-muted-foreground">ADR (month)</p><p className="text-2xl font-bold">{formatCurrency(metrics.adr)}</p></Card>
            <Card className="p-4"><p className="text-sm text-muted-foreground">RevPAR</p><p className="text-2xl font-bold">{formatCurrency(metrics.revpar)}</p></Card>
            <Card className="p-4"><p className="text-sm text-muted-foreground">Occupancy</p><p className="text-2xl font-bold">{metrics.occupancyRate}%</p></Card>
            <Card className="p-4"><p className="text-sm text-muted-foreground">Room Revenue (MTD)</p><p className="text-2xl font-bold">{formatCurrency(metrics.roomRevenue)}</p></Card>
          </div>

          {chartData.length > 0 && (
            <Card className="p-4">
              <h2 className="font-semibold mb-4">Night Audit Trends</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                  <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" />
                  <Bar dataKey="adr" fill="#10b981" name="ADR" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="font-semibold mb-2">Summary</h2>
            <p className="text-sm text-muted-foreground">
              {metrics.occupied} of {metrics.totalRooms} rooms occupied · {metrics.roomNights} room nights this month
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}
