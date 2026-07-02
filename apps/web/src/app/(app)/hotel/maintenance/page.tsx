'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Room = {
  id: string;
  roomNumber: string;
  status: string;
  floor?: number;
  notes?: string | null;
  category: { name: string };
};

export default function MaintenancePage() {
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

  const { data: rooms, isLoading } = useQuery<Room[]>({
    queryKey: ['rooms', branchId],
    queryFn: () => api<Room[]>(`/hotel/rooms?branchId=${branchId}`, { token }),
    enabled: !!branchId,
  });

  const updateStatus = useMutation({
    mutationFn: ({ roomId, status }: { roomId: string; status: string }) =>
      api(`/hotel/rooms/${roomId}`, { method: 'PATCH', token, body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Room status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const maintenanceRooms = rooms?.filter((r) => r.status === 'MAINTENANCE') ?? [];
  const otherRooms = rooms?.filter((r) => r.status !== 'MAINTENANCE') ?? [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6" /> Maintenance</h1>
          <p className="text-sm text-muted-foreground">Mark rooms out of service for repairs</p>
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div>
        <h2 className="font-semibold mb-3 text-orange-700">Under Maintenance ({maintenanceRooms.length})</h2>
        {isLoading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : maintenanceRooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rooms under maintenance</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {maintenanceRooms.map((room) => (
              <Card key={room.id} className="p-4 border-orange-200 bg-orange-50">
                <p className="font-bold">Room {room.roomNumber}</p>
                <p className="text-xs text-muted-foreground">{room.category.name} · Floor {room.floor ?? '—'}</p>
                {room.notes && <p className="text-sm mt-1">{room.notes}</p>}
                <Button size="sm" className="mt-3" variant="outline" onClick={() => updateStatus.mutate({ roomId: room.id, status: 'AVAILABLE' })}>
                  Mark Available
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-3">All Rooms</h2>
        <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {otherRooms.map((room) => (
            <div
              key={room.id}
              className={cn(
                'p-3 rounded-lg border text-sm flex justify-between items-center',
                room.status === 'AVAILABLE' ? 'bg-emerald-50' : 'bg-muted/30',
              )}
            >
              <div>
                <p className="font-medium">{room.roomNumber}</p>
                <p className="text-xs text-muted-foreground">{room.status}</p>
              </div>
              {room.status === 'AVAILABLE' && (
                <Button size="sm" variant="ghost" className="text-orange-600 text-xs" onClick={() => updateStatus.mutate({ roomId: room.id, status: 'MAINTENANCE' })}>
                  Repair
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
