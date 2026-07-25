'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { ArrowLeft, Sparkles, UserPlus, CalendarDays } from 'lucide-react';
import Link from 'next/link';

function CheckInForm() {
  const token = useAuthStore((s) => s.accessToken)!;
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  
  const branchParam = searchParams.get('branchId') || '';
  const [branchId, setBranchId] = useState(branchParam);

  // Resolve a HOTEL branch even when opened directly (no ?branchId) — the Hotel
  // PMS "Check-in" tab links here with no branchId, and the API would otherwise
  // fall back to the user's SHOP branch and return zero hotel rooms.
  const { data: hotelBranches } = useQuery({
    queryKey: ['branches', 'HOTEL'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/branches?type=HOTEL', { token }),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!branchId && hotelBranches && hotelBranches.length > 0) setBranchId(hotelBranches[0].id);
  }, [hotelBranches, branchId]);

  const preSelectedRoomId = searchParams.get('roomId') || '';
  const preCheckIn = searchParams.get('checkIn') || new Date().toISOString().slice(0, 10);
  const preCheckOut = searchParams.get('checkOut') || '';
  const preRate = searchParams.get('rate') || '';

  const [bookingType, setBookingType] = useState<'CHECKIN' | 'RESERVATION'>('CHECKIN');
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    roomId: preSelectedRoomId,
    firstName: '',
    lastName: '',
    phone: '',
    checkIn: preCheckIn,
    checkOut: preCheckOut,
    roomRate: preRate ? Number(preRate) : 0,
    idProofType: 'Aadhaar',
    documentUrl: '',
  });

  // Only offer BOOKABLE rooms: immediate check-in -> AVAILABLE now; future
  // reservation -> rooms free for the chosen date range (no overlapping booking).
  const rangeReady = bookingType === 'RESERVATION' && !!form.checkIn && !!form.checkOut;
  const { data: rooms } = useQuery({
    queryKey: ['rooms-available', branchId, bookingType, rangeReady ? form.checkIn : '', rangeReady ? form.checkOut : ''],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (branchId) qs.set('branchId', branchId);
      if (bookingType === 'CHECKIN') qs.set('status', 'AVAILABLE');
      else if (rangeReady) { qs.set('from', form.checkIn); qs.set('to', form.checkOut); }
      return api<Array<{ id: string; roomNumber: string; status: string; category: { basePrice: number } }>>(
        `/hotel/rooms?${qs.toString()}`,
        { token },
      );
    },
    enabled: !!branchId,
  });

  useEffect(() => {
    if (preSelectedRoomId && rooms) {
      const room = rooms.find((r) => r.id === preSelectedRoomId);
      if (room && !form.roomRate) {
        setForm((f) => ({ ...f, roomRate: Number(room.category.basePrice) }));
      }
    }
  }, [preSelectedRoomId, rooms]);

  // If the currently-picked room is no longer bookable (filtered out), clear it.
  useEffect(() => {
    if (form.roomId && rooms && !rooms.some((r) => r.id === form.roomId)) {
      setForm((f) => ({ ...f, roomId: '' }));
    }
  }, [rooms, form.roomId]);

  const uploadDocument = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      toast.loading('Uploading document...');
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/hotel/guest-document`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      toast.dismiss();
      if (!res.ok) throw new Error(data.message);
      setForm((f) => ({ ...f, documentUrl: data.documentUrl || '' }));
      toast.success('Document uploaded');
    } catch (err) {
      toast.dismiss();
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.roomId) {
      toast.error('Please select a room');
      return;
    }
    const room = rooms?.find((r) => r.id === form.roomId);
    const rateToUse = form.roomRate || Number(room?.category.basePrice || 0);

    try {
      const endpoint = bookingType === 'CHECKIN' ? '/hotel/check-in' : '/hotel/reservations';
      await api(endpoint, {
        method: 'POST',
        token,
        body: JSON.stringify({
          roomId: form.roomId,
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          roomRate: rateToUse,
          guest: {
            firstName: form.firstName,
            lastName: form.lastName,
            phone: form.phone,
            aadhaarDocUrl: form.documentUrl,
            idProofType: form.idProofType,
          },
        }),
      });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['hotel-stats'] });
      qc.invalidateQueries({ queryKey: ['hotel-profit'] });
      toast.success(bookingType === 'CHECKIN' ? 'Guest checked in successfully' : 'Future reservation created successfully');
      router.push(`/hotel?branchId=${branchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Operation failed');
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/hotel?branchId=${branchId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">New Booking & Check-In</h1>
      </div>

      {/* Booking Type Selector */}
      <div className="grid grid-cols-2 gap-2 bg-muted p-1 rounded-lg">
        <button
          type="button"
          onClick={() => setBookingType('CHECKIN')}
          className={`py-2 text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
            bookingType === 'CHECKIN' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
        >
          <UserPlus className="h-4 w-4" />
          Immediate Check-In
        </button>
        <button
          type="button"
          onClick={() => setBookingType('RESERVATION')}
          className={`py-2 text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
            bookingType === 'RESERVATION' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
        >
          <CalendarDays className="h-4 w-4" />
          Future Reservation
        </button>
      </div>

      <Card className="p-4 space-y-3">
        <p className="font-medium flex items-center gap-1.5 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          Guest ID Upload
        </p>
        <div className="flex gap-3 items-center">
          <select 
            className="h-10 rounded-lg border px-3 bg-background text-sm"
            value={form.idProofType}
            onChange={(e) => setForm({ ...form, idProofType: e.target.value })}
          >
            <option value="Aadhaar">Aadhaar</option>
            <option value="Passport">Passport</option>
            <option value="Driving License">Driving License</option>
            <option value="Other">Other</option>
          </select>
          <Input type="file" className="flex-1" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Button type="button" variant="outline" onClick={uploadDocument} disabled={!file}>
          {form.documentUrl ? 'Uploaded ✓' : 'Upload'}
        </Button>
        {form.documentUrl && <p className="text-xs text-emerald-600">Document saved securely.</p>}
      </Card>

      <form onSubmit={submit} className="space-y-4">
        {(hotelBranches?.length ?? 0) > 1 && (
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Property</label>
            <select
              className="h-10 w-full rounded-lg border px-3 bg-background text-sm"
              value={branchId}
              onChange={(e) => { setBranchId(e.target.value); setForm((f) => ({ ...f, roomId: '' })); }}
            >
              {hotelBranches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Room Selection</label>
          <select
            className="w-full h-10 rounded-lg border px-3 bg-background text-sm"
            required
            value={form.roomId}
            onChange={(e) => {
              const room = rooms?.find((r) => r.id === e.target.value);
              setForm({
                ...form,
                roomId: e.target.value,
                roomRate: Number(room?.category.basePrice ?? 0),
              });
            }}
          >
            <option value="">Select room</option>
            {rooms?.map((r) => (
              <option key={r.id} value={r.id}>
                Room {r.roomNumber} ({r.status}) — ₹{r.category.basePrice}/night
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Guest First Name</label>
            <Input placeholder="First name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Guest Last Name</label>
            <Input placeholder="Last name" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Guest Phone Number</label>
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Check-in Date</label>
            <Input type="date" required value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Check-out Date</label>
            <Input type="date" required value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Custom Room Rate (₹ per night)</label>
          <Input type="number" placeholder="Room Rate" value={form.roomRate || ''} onChange={(e) => setForm({ ...form, roomRate: Number(e.target.value) })} />
        </div>

        <Button type="submit" size="lg" className="w-full">
          {bookingType === 'CHECKIN' ? 'Complete Check-In' : 'Save Reservation'}
        </Button>
      </form>
    </div>
  );
}

export default function CheckInPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading form...</div>}>
      <CheckInForm />
    </Suspense>
  );
}
