'use client';

import { useState, useEffect, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DollarSign, Users, Home, TrendingUp, Calendar, AlertCircle, Wallet, Building } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { useRouter, useSearchParams } from 'next/navigation';

type HotelStats = {
  totalRooms: number;
  occupied: number;
  reserved: number;
  cleaning: number;
  available: number;
  occupancyRate: number;
  utilizationRate: number;
  totalRevenue: number;
  monthRevenue: number;
  todayRevenue: number;
  yearRevenue: number;
  todayProfit: number;
  monthProfit: number;
  yearProfit: number;
  netProfit: number;
  collected: number;
  serviceRevenue: number;
  totalCollected: number;
  pendingAmount: number;
  totalReservations: number;
};

function HotelDashboardContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.accessToken)!;
  const searchParams = useSearchParams();
  const initialBranchId = searchParams.get('branchId') || '';

  const [selectedBranchId, setSelectedBranchId] = useState<string>(initialBranchId);

  // Fetch branches
  const { data: branches } = useQuery<any[]>({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<any[]>('/branches?type=HOTEL', { token }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (branches && branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  const { data: stats, isLoading } = useQuery<HotelStats>({
    queryKey: ['hotel-stats', selectedBranchId],
    // Pass branchId as an api() option so x-branch-id targets the hotel branch (the report
    // endpoint also honors ?branchId). refetchOnMount:'always' + interval => near real-time.
    queryFn: () => api<HotelStats>('/reports/hotel', { token, branchId: selectedBranchId }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    enabled: !!selectedBranchId,
  });

  const { data: reservations } = useQuery({
    queryKey: ['hotel-reservations-recent', selectedBranchId],
    queryFn: () => api<any[]>('/hotel/reservations?status=CHECKED_IN', { token, branchId: selectedBranchId }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    enabled: !!selectedBranchId,
  });

  const { data: revenueMetrics } = useQuery<{
    adr: number;
    revpar: number;
    occupancyRate: number;
    auditHistory: { auditDate: string; roomRevenue: number | string; occupancyRate: number | string }[];
  }>({
    queryKey: ['revenue-metrics', selectedBranchId],
    queryFn: () => api('/hotel/revenue-metrics', { token, branchId: selectedBranchId }),
    refetchOnMount: 'always',
    enabled: !!selectedBranchId,
  });

  const kpiCards = [
    {
      label: "Today's Sales",
      value: formatCurrency(stats?.todayRevenue ?? 0),
      icon: DollarSign,
      color: 'text-emerald-500',
    },
    {
      label: 'Month Sales',
      value: formatCurrency(stats?.monthRevenue ?? 0),
      icon: TrendingUp,
      color: 'text-blue-500',
    },
    {
      label: 'Year Sales',
      value: formatCurrency(stats?.yearRevenue ?? 0),
      icon: Wallet,
      color: 'text-purple-500',
    },
    {
      label: 'Today Profit',
      value: formatCurrency(stats?.todayProfit ?? 0),
      icon: DollarSign,
      color: 'text-emerald-400',
    },
    {
      label: 'Month Profit',
      value: formatCurrency(stats?.monthProfit ?? 0),
      icon: TrendingUp,
      color: 'text-emerald-500',
    },
    {
      label: 'Year Profit',
      value: formatCurrency(stats?.yearProfit ?? 0),
      icon: Wallet,
      color: 'text-emerald-600',
    },
    {
      label: 'Service Revenue',
      value: formatCurrency(stats?.serviceRevenue ?? 0),
      icon: Wallet,
      color: 'text-teal-500',
    },
    {
      label: 'Pending Collection',
      value: formatCurrency(stats?.pendingAmount ?? 0),
      icon: AlertCircle,
      color: 'text-orange-500',
    },
    {
      label: 'Occupancy Rate',
      value: `${stats?.occupancyRate ?? 0}%`,
      icon: TrendingUp,
      color: 'text-cyan-500',
    },
  ];

  const revenueChartData = (revenueMetrics?.auditHistory ?? [])
    .map((a) => ({
      date: new Date(a.auditDate).toLocaleDateString('en', { weekday: 'short' }),
      revenue: Number(a.roomRevenue),
      occupancy: Number(a.occupancyRate),
    }))
    .reverse();

  const kpiExtras = revenueMetrics
    ? [
        { label: 'ADR', value: formatCurrency(revenueMetrics.adr), icon: TrendingUp, color: 'text-indigo-500' },
        { label: 'RevPAR', value: formatCurrency(revenueMetrics.revpar), icon: DollarSign, color: 'text-violet-500' },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header & Branch Switcher */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-4 rounded-xl border border-white/5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building className="h-6 w-6 text-primary" /> Hotel Dashboard
          </h1>
          <p className="text-xs text-muted-foreground">Revenue, occupancy and room statistics for the selected branch</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-background/50 border border-white/10 px-3 py-1.5 rounded-lg w-full md:w-auto">
            <Building className="h-4 w-4 text-muted-foreground" />
            <select
              className="bg-transparent border-0 outline-none text-sm font-medium w-full md:w-40"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
            >
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <Button variant="outline" size="sm" onClick={() => router.push(`/hotel?branchId=${selectedBranchId}`)}>
            Room Management
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/hotel/check-in?branchId=${selectedBranchId}`)}>
            Check-in Guest
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...kpiCards, ...kpiExtras].map((card, idx) => {
          const Icon = card.icon;
          return (
            <Card key={idx} className="p-4 space-y-2">
              <div className="flex justify-between items-start">
                <span className="text-sm text-muted-foreground">{card.label}</span>
                <Icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <p className="text-2xl font-bold">{card.value}</p>
            </Card>
          );
        })}
      </div>

      {/* Revenue & Occupancy Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="font-semibold mb-4">Night Audit Revenue Trend</h2>
          {revenueChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Run night audit to see revenue trends</p>
          ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={revenueChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#10b981" name="Revenue" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-4">Occupancy Rate Trend</h2>
          {revenueChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Run night audit to see occupancy trends</p>
          ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              <Bar dataKey="occupancy" fill="#3b82f6" name="Occupancy %" />
            </BarChart>
          </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Room Status Overview */}
      <Card className="p-4">
        <h2 className="font-semibold mb-4">Room Status Overview</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <p className="text-sm text-emerald-700">Available</p>
            <p className="text-2xl font-bold text-emerald-900">{stats?.available ?? 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-700">Occupied</p>
            <p className="text-2xl font-bold text-red-900">{stats?.occupied ?? 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-700">Reserved</p>
            <p className="text-2xl font-bold text-amber-900">{stats?.reserved ?? 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <p className="text-sm text-blue-700">Cleaning</p>
            <p className="text-2xl font-bold text-blue-900">{stats?.cleaning ?? 0}</p>
          </div>
        </div>
      </Card>

      {/* Recent Check-ins */}
      <Card className="p-4">
        <h2 className="font-semibold mb-4">Recent Check-ins</h2>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {reservations && reservations.length > 0 ? (
            reservations.slice(0, 8).map((res) => (
              <div key={res.id} className="flex justify-between items-center p-2 rounded hover:bg-muted transition-colors">
                <div>
                  <p className="font-medium">
                    {res.guest.firstName} {res.guest.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Room {res.room.roomNumber} · {res.bookingRef}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-sm">{formatCurrency(Number(res.totalAmount))}</p>
                  <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                    {res.status}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-center py-4">No active check-ins</p>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function HotelDashboardPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-muted-foreground">Loading hotel dashboard...</div>}>
      <HotelDashboardContent />
    </Suspense>
  );
}
