'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building, Plus, AlertTriangle, ShieldAlert, CheckCircle2, Play, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const COLUMNS = [
  { id: 'PENDING', label: 'Pending', color: 'border-amber-500/20 bg-amber-500/5 text-amber-500', icon: AlertTriangle },
  { id: 'IN_PROGRESS', label: 'In Progress', color: 'border-blue-500/20 bg-blue-500/5 text-blue-400', icon: Play },
  { id: 'COMPLETED', label: 'Completed', color: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400', icon: CheckCircle2 },
] as const;

interface Task {
  id: string;
  status: string;
  priority: string;
  notes?: string | null;
  room: { id: string; roomNumber: string };
  assignedTo?: string | null;
  assignee?: { firstName: string; lastName: string } | null;
}

interface Room {
  id: string;
  roomNumber: string;
  floor?: number;
}

export default function HousekeepingPage() {
  const token = useAuthStore((s) => s.accessToken)!;
  const qc = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ roomId: '', priority: 'NORMAL', notes: '' });

  // Fetch Branches
  const { data: branches } = useQuery<any[]>({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<any[]>('/branches?type=HOTEL', { token }),
    staleTime: 60_000,
  });

  // Fetch staff members
  const { data: staffMembers } = useQuery<any[]>({
    queryKey: ['users'],
    queryFn: () => api<any[]>('/users', { token }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (branches && branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  // Fetch Rooms for dropdown
  const { data: rooms } = useQuery<Room[]>({
    queryKey: ['rooms', selectedBranchId],
    queryFn: () => api<Room[]>(`/hotel/rooms${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, { token }),
    enabled: !!selectedBranchId,
  });

  useEffect(() => {
    if (rooms && rooms.length > 0) {
      setForm((prev) => ({ ...prev, roomId: rooms[0].id }));
    }
  }, [rooms]);

  // Fetch Housekeeping Tasks
  const { data: tasks } = useQuery({
    queryKey: ['housekeeping', selectedBranchId],
    queryFn: () => api<Task[]>(`/housekeeping${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, { token }),
    enabled: !!selectedBranchId,
    refetchInterval: 8000,
  });

  // Create Task Mutation
  const createTask = useMutation({
    mutationFn: (data: typeof form) =>
      api('/housekeeping', { method: 'POST', token, body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping', selectedBranchId] });
      toast.success('Housekeeping task created');
      setDialogOpen(false);
      setForm((prev) => ({ ...prev, notes: '' }));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create task');
    },
  });

  // Update Status Mutation
  const updateStatus = useMutation({
    mutationFn: ({ id, status, assignedTo }: { id: string; status: string; assignedTo?: string }) =>
      api(`/housekeeping/${id}`, { method: 'PATCH', token, body: JSON.stringify({ status, assignedTo: assignedTo || undefined }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping', selectedBranchId] });
      toast.success('Status updated successfully');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.roomId) {
      toast.error('Please select a room');
      return;
    }
    createTask.mutate(form);
  };

  const getPriorityBadge = (prio: string) => {
    switch (prio) {
      case 'HIGH':
        return 'bg-red-500/10 text-red-500 border border-red-500/20';
      case 'LOW':
        return 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20';
      default:
        return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
    }
  };

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      {/* Header & Branch Switcher */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-4 rounded-xl border border-white/5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building className="h-6 w-6 text-primary" />
            Housekeeping Tasks
          </h1>
          <p className="text-xs text-muted-foreground">Manage cleaning and maintenance tasks per property branch</p>
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

          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" /> Add Task
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 min-h-0 overflow-hidden">
        {COLUMNS.map((col) => {
          const colTasks = tasks?.filter((t) => t.status === col.id) ?? [];
          const ColIcon = col.icon;
          return (
            <div key={col.id} className={cn('rounded-xl border flex flex-col min-h-0 bg-card/40 backdrop-blur-sm', col.id === 'PENDING' ? 'border-amber-500/10' : col.id === 'IN_PROGRESS' ? 'border-blue-500/10' : 'border-emerald-500/10')}>
              <div className="p-4 border-b border-white/5 font-semibold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ColIcon className={cn('h-5 w-5', col.id === 'PENDING' ? 'text-amber-500' : col.id === 'IN_PROGRESS' ? 'text-blue-400' : 'text-emerald-400')} />
                  <span>{col.label}</span>
                </div>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">{colTasks.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {colTasks.map((task) => (
                  <Card key={task.id} className="p-4 bg-card/60 border-white/5 hover:border-white/10 transition-all flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex justify-between items-start">
                        <p className="text-xl font-bold tracking-tight">Room {task.room.roomNumber}</p>
                        <span className={cn('text-[10px] px-2 py-0.5 font-bold rounded-md uppercase tracking-wider', getPriorityBadge(task.priority))}>
                          {task.priority}
                        </span>
                      </div>
                      {task.notes && (
                        <p className="text-xs text-muted-foreground mt-2 bg-black/10 p-2 rounded border border-white/5 italic">
                          &ldquo;{task.notes}&rdquo;
                        </p>
                      )}
                      {task.assignee && (
                        <p className="text-xs mt-2 text-muted-foreground">
                          Assignee: <span className="text-foreground font-medium">{task.assignee.firstName} {task.assignee.lastName}</span>
                        </p>
                      )}
                      
                      {col.id !== 'COMPLETED' && (
                        <div className="space-y-1 mt-2.5 pt-2 border-t border-white/5">
                          <label className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground block">Assign Staff</label>
                          <select
                            className="w-full h-8 rounded border border-white/10 px-2 bg-slate-900 text-xs text-foreground focus:outline-none focus:border-primary"
                            value={task.assignedTo || ''}
                            onChange={(e) => {
                              updateStatus.mutate({ 
                                id: task.id, 
                                status: task.status, 
                                assignedTo: e.target.value || undefined 
                              });
                            }}
                          >
                            <option value="">Unassigned</option>
                            {staffMembers?.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.firstName} {member.lastName} ({member.role})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    {col.id !== 'COMPLETED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn('w-full text-xs h-8 font-medium transition-all hover:bg-opacity-80 mt-2', col.id === 'PENDING' ? 'hover:bg-blue-500/10 hover:text-blue-400 border-blue-500/20' : 'hover:bg-emerald-500/10 hover:text-emerald-400 border-emerald-500/20')}
                        onClick={() => {
                          const next = col.id === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED';
                          updateStatus.mutate({ id: task.id, status: next, assignedTo: task.assignedTo || undefined });
                        }}
                      >
                        {col.id === 'PENDING' ? (
                          <>
                            <Play className="h-3 w-3 mr-1.5" /> Start Cleaning
                          </>
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5 mr-1.5" /> Mark Cleaned
                          </>
                        )}
                      </Button>
                    )}
                  </Card>
                ))}
                {!colTasks.length && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2 opacity-60">
                    <ShieldAlert className="h-8 w-8 stroke-1" />
                    <p className="text-xs font-medium">No tasks in this stage</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Task Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-card border border-white/10 text-foreground">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Add Housekeeping Task</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-4">
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
              <label className="text-sm font-medium">Priority</label>
              <select
                className="w-full h-10 rounded-lg border border-white/10 px-3 bg-background text-foreground focus:outline-none"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes / Instructions</label>
              <textarea
                className="w-full rounded-lg border border-white/10 px-3 py-2 bg-background text-foreground focus:outline-none"
                rows={3}
                placeholder="e.g. Needs deep sheet cleaning, double towels..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createTask.isPending}>
                Create Task
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
