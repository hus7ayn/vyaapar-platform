'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building, Plus, Bell, Clock, Compass, CheckCircle, Play, ArrowRight, DollarSign } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as const;
const SERVICE_TYPES = ['ROOM_SERVICE', 'LAUNDRY', 'FOOD', 'SPA', 'CAB', 'MINIBAR'];

const STATUS_DETAILS = {
  PENDING: { label: 'Pending', border: 'border-amber-500/10', bg: 'bg-amber-500/5', text: 'text-amber-500', icon: Bell },
  ASSIGNED: { label: 'Assigned', border: 'border-indigo-500/10', bg: 'bg-indigo-500/5', text: 'text-indigo-400', icon: Clock },
  IN_PROGRESS: { label: 'In Progress', border: 'border-blue-500/10', bg: 'bg-blue-500/5', text: 'text-blue-400', icon: Compass },
  COMPLETED: { label: 'Completed', border: 'border-emerald-500/10', bg: 'bg-emerald-500/5', text: 'text-emerald-400', icon: CheckCircle },
} as const;

interface ServiceRequest {
  id: string;
  serviceType: string;
  status: string;
  description?: string;
  amount?: number | string | null;
  room?: { id: string; roomNumber: string } | null;
}

interface Room {
  id: string;
  roomNumber: string;
  floor?: number;
}

export default function ServicesPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ serviceType: 'ROOM_SERVICE', description: '', roomId: '', amount: '' });

  // Fetch Branches
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

  // Fetch Rooms for dropdown selection
  const { data: rooms } = useQuery<Room[]>({
    queryKey: ['rooms', selectedBranchId],
    queryFn: () => api<Room[]>(`/hotel/rooms${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, { token }),
    enabled: !!selectedBranchId,
  });

  useEffect(() => {
    if (rooms && rooms.length > 0) {
      setForm((prev) => ({ ...prev, roomId: rooms[0].id }));
    } else {
      setForm((prev) => ({ ...prev, roomId: '' }));
    }
  }, [rooms]);

  // Fetch Service Requests for active branch
  const { data: requests } = useQuery({
    queryKey: ['services', selectedBranchId],
    queryFn: () => api<ServiceRequest[]>(`/services${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, { token }),
    enabled: !!selectedBranchId,
    refetchInterval: 10000,
  });

  // Create Service Request
  const create = useMutation({
    mutationFn: () =>
      api('/services', {
        method: 'POST',
        token,
        body: JSON.stringify({
          serviceType: form.serviceType,
          description: form.description,
          roomId: form.roomId || null,
          amount: form.amount ? Number(form.amount) : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services', selectedBranchId] });
      toast.success('Service request created');
      setShowForm(false);
      setForm((prev) => ({ ...prev, description: '', amount: '' }));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create request');
    },
  });

  // Update Status
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/services/${id}`, { method: 'PATCH', token, body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services', selectedBranchId] });
      toast.success('Request status advanced');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to advance status');
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.roomId) {
      toast.error('Please select a room');
      return;
    }
    create.mutate();
  };

  const getServiceTypeColor = (type: string) => {
    switch (type) {
      case 'ROOM_SERVICE':
        return 'bg-pink-500/10 text-pink-400 border border-pink-500/20';
      case 'LAUNDRY':
        return 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
      case 'FOOD':
        return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
      case 'SPA':
        return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
      case 'CAB':
        return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
      default:
        return 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20';
    }
  };

  const formatCurrency = (amount: number | string) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(amount));
  };

  return (
    <div className="p-6 space-y-6 h-[calc(100vh-4rem)] flex flex-col">
      {/* Header & Branch Switcher */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-4 rounded-xl border border-white/5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building className="h-6 w-6 text-primary" />
            Service Requests
          </h1>
          <p className="text-xs text-muted-foreground">Manage and track room service, laundry, spa & cab requests per branch</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-background/50 border border-white/10 px-3 py-1.5 rounded-lg w-full md:w-auto">
            <Building className="h-4 w-4 text-muted-foreground" />
            <select
              className="bg-transparent border-0 outline-none text-sm font-medium w-full md:w-40 text-foreground"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
            >
              {branches?.map((b) => (
                <option key={b.id} value={b.id} className="bg-popover text-foreground">
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" /> New Request
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 min-h-0 overflow-hidden">
        {STATUSES.map((status) => {
          const colRequests = requests?.filter((r) => r.status === status) ?? [];
          const statusDetail = STATUS_DETAILS[status];
          const Icon = statusDetail.icon;

          return (
            <div key={status} className={cn('rounded-xl border flex flex-col min-h-0 bg-card/40 backdrop-blur-sm', statusDetail.border)}>
              <div className="p-4 border-b border-white/5 font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className={cn('h-5 w-5', statusDetail.text)} />
                  <span className="text-sm">{statusDetail.label}</span>
                </div>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
                  {colRequests.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {colRequests.map((r) => (
                  <Card key={r.id} className="p-4 bg-card/60 border-white/5 hover:border-white/10 transition-all flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex justify-between items-start">
                        <span className={cn('text-[10px] px-2 py-0.5 font-bold rounded-md uppercase tracking-wider', getServiceTypeColor(r.serviceType))}>
                          {r.serviceType.replace('_', ' ')}
                        </span>
                        {r.amount !== null && r.amount !== undefined && (
                          <span className="text-xs font-mono font-bold text-primary">
                            {formatCurrency(r.amount)}
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-lg mt-2">
                        {r.room ? `Room ${r.room.roomNumber}` : 'No Room'}
                      </p>
                      {r.description && (
                        <p className="text-xs text-muted-foreground mt-2 bg-black/10 p-2 rounded border border-white/5">
                          {r.description}
                        </p>
                      )}
                    </div>
                    {status !== 'COMPLETED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs h-8 font-medium transition-all hover:bg-opacity-80 hover:bg-primary/10 hover:text-primary border-primary/20"
                        onClick={() => {
                          const idx = STATUSES.indexOf(status);
                          if (idx < STATUSES.length - 1) {
                            updateStatus.mutate({ id: r.id, status: STATUSES[idx + 1] });
                          }
                        }}
                      >
                        <ArrowRight className="h-3 w-3 mr-1.5" /> Advance Status
                      </Button>
                    )}
                  </Card>
                ))}
                {!colRequests.length && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2 opacity-50">
                    <Icon className="h-6 w-6 stroke-1" />
                    <p className="text-[11px] font-medium">No requests here</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Request Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-[425px] bg-card border border-white/10 text-foreground">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">New Service Request</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Service Type</label>
              <select
                className="w-full h-10 rounded-lg border border-white/10 px-3 bg-background text-foreground focus:outline-none"
                value={form.serviceType}
                onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
              >
                {SERVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Room</label>
              <select
                className="w-full h-10 rounded-lg border border-white/10 px-3 bg-background text-foreground focus:outline-none"
                value={form.roomId}
                onChange={(e) => setForm({ ...form, roomId: e.target.value })}
                required
              >
                {rooms?.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.roomNumber} {r.floor ? `(Floor ${r.floor})` : ''}
                  </option>
                ))}
                {(!rooms || rooms.length === 0) && (
                  <option value="">No rooms available</option>
                )}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Amount to Charge (₹) - Optional</label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 500"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Request Notes / Details</label>
              <textarea
                className="w-full rounded-lg border border-white/10 px-3 py-2 bg-background text-foreground focus:outline-none"
                rows={3}
                placeholder="e.g. Needs laundry before 5 PM, bring 2 plates..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                Submit Request
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
