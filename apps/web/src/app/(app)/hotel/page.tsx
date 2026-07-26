'use client';

import { FormEvent, useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn, formatCurrency } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { ReservationCalendar } from '@/components/hotel/reservation-calendar';
import { printHtmlDocument } from '@/lib/print-html';
import { Building, Search, Calendar, DollarSign, AlertCircle, RefreshCw, X } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/30',
  OCCUPIED: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800/30',
  RESERVED: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/30',
  CLEANING: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800/30',
  MAINTENANCE: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950/30 dark:text-gray-300 dark:border-gray-800/30',
};

const ROOM_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'MAINTENANCE'] as const;

// The stored paymentType 'BANK' is shown to users as "Bank Transfer".
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  UPI: 'UPI',
  CARD: 'Card',
};

type HotelRoom = {
  id: string;
  roomNumber: string;
  status: string;
  floor?: number;
  notes?: string | null;
  price?: number | string | null;
  category: { id: string; name: string; basePrice: number; description?: string | null };
};

type RoomCategory = {
  id: string;
  name: string;
  description?: string | null;
  basePrice: number;
};

type FolioCharge = {
  id: string;
  description: string;
  amount: number | string;
  chargeType: string;
  createdAt: string;
};

type Reservation = {
  id: string;
  bookingRef: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  checkIn: string;
  checkOut: string;
  guest: { firstName: string; lastName: string; documentPublicUrl?: string; idProofType?: string };
  room: { id: string; roomNumber: string };
  folioCharges: FolioCharge[];
  folioPayments?: { id: string; method: string; amount: number | string; reference?: string | null }[];
  serviceRequests?: any[];
};

type RoomForm = {
  id?: string;
  roomNumber: string;
  categoryId: string;
  floor: string;
  notes: string;
  status: string;
  price: string;
};

const initialRoomForm: RoomForm = {
  roomNumber: '',
  categoryId: '',
  floor: '',
  notes: '',
  status: 'AVAILABLE',
  price: '',
};

export default function HotelPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.accessToken)!;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'rooms' | 'calendar' | 'availability' | 'reservations'>('rooms');
  const [reservationSubTab, setReservationSubTab] = useState<'active' | 'history'>('active');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');

  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<HotelRoom | null>(null);
  const [roomForm, setRoomForm] = useState<RoomForm>(initialRoomForm);

  const [cancelReservationId, setCancelReservationId] = useState<string | null>(null);
  const [cancellationFee, setCancellationFee] = useState(0);
  const [refundAmount, setRefundAmount] = useState(0);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchForm, setNewBranchForm] = useState({ name: '', code: '', address: '' });

  // Checkout and Folio states
  const [checkoutReservation, setCheckoutReservation] = useState<Reservation | null>(null);
  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [newChargeForm, setNewChargeForm] = useState({ description: '', amount: '' });
  const [newPaymentAmount, setNewPaymentAmount] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState('CASH');
  const [newPaymentBankId, setNewPaymentBankId] = useState('');
  // Settlement of the final balance chosen at the moment of checkout.
  const [checkoutMethod, setCheckoutMethod] = useState('CASH');
  const [checkoutBankId, setCheckoutBankId] = useState('');
  // Split payment: settle the bill across several methods.
  const [checkoutSplit, setCheckoutSplit] = useState(false);
  const [splitRows, setSplitRows] = useState<{ method: string; amount: string; bankAccountId: string }[]>([
    { method: 'CASH', amount: '', bankAccountId: '' },
  ]);

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api<Array<{ id: string; name: string; accountType: string }>>('/cash-bank/accounts', { token }),
    enabled: !!token,
  });

  // Availability Finder State
  const [availCheckIn, setAvailCheckIn] = useState(new Date().toISOString().split('T')[0]);
  const [availCheckOut, setAvailCheckOut] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [availabilityResults, setAvailabilityResults] = useState<HotelRoom[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

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

  const { data: rooms } = useQuery<HotelRoom[]>({
    queryKey: ['rooms', selectedBranchId],
    queryFn: () => api<HotelRoom[]>(`/hotel/rooms${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, { token }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !!selectedBranchId,
  });

  const { data: categories } = useQuery<RoomCategory[]>({
    queryKey: ['room-categories', selectedBranchId],
    queryFn: () => api<RoomCategory[]>(`/hotel/room-categories${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, { token }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !!selectedBranchId,
  });

  const { data: reservations } = useQuery<Reservation[]>({
    queryKey: ['reservations', selectedBranchId],
    queryFn: () => api<Reservation[]>(`/hotel/reservations${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, { token }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !!selectedBranchId,
  });

  const createBranchMutation = useMutation({
    mutationFn: async (data: typeof newBranchForm) =>
      api<any>('/branches', {
        method: 'POST',
        token,
        body: JSON.stringify({ ...data, type: 'HOTEL' }),
      }),
    onSuccess: (newBranch) => {
      queryClient.invalidateQueries({ queryKey: ['branches', 'HOTEL'] });
      toast.success('Hotel branch added successfully');
      setNewBranchOpen(false);
      setNewBranchForm({ name: '', code: '', address: '' });
      if (newBranch?.id) {
        setSelectedBranchId(newBranch.id);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add hotel branch');
    },
  });

  const cancelReservationMutation = useMutation({
    mutationFn: async (data: { id: string; cancellationFee: number; refundAmount: number }) =>
      api<any>(`/hotel/reservations/${data.id}/cancel`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          cancellationFee: data.cancellationFee,
          refundAmount: data.refundAmount,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['rooms', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-stats', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Booking cancelled successfully');
      setCancelDialogOpen(false);
      setCancelReservationId(null);
      setCancellationFee(0);
      setRefundAmount(0);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel booking');
    },
  });

  const markAsPaidMutation = useMutation({
    mutationFn: async (data: { id: string; paidAmount: number }) =>
      api<any>(`/hotel/reservations/${data.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ paidAmount: data.paidAmount }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-stats', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Reservation marked as paid');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to mark as paid');
    },
  });

  const checkInReservationMutation = useMutation({
    mutationFn: async (id: string) =>
      api<any>(`/hotel/reservations/${id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status: 'CHECKED_IN' }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['rooms', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-stats', selectedBranchId] });
      toast.success('Guest checked in successfully');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to check in');
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ id, settle }: {
      id: string;
      settle?: {
        method?: string;
        amount?: number;
        bankAccountId?: string;
        payments?: { method: string; amount: number; bankAccountId?: string }[];
      };
    }) =>
      api<any>(`/hotel/check-out/${id}`, {
        method: 'POST',
        token,
        body: settle ? JSON.stringify(settle) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['rooms', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-stats', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Guest checked out successfully');
      setCheckoutMethod('CASH');
      setCheckoutBankId('');
      setCheckoutSplit(false);
      setSplitRows([{ method: 'CASH', amount: '', bankAccountId: '' }]);
      setCheckoutDialogOpen(false);
      setCheckoutReservation(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to check out');
    },
  });

  const addFolioChargeMutation = useMutation({
    mutationFn: async (data: { id: string; description: string; amount: number }) =>
      api<any>(`/hotel/reservations/${data.id}/folio`, {
        method: 'POST',
        token,
        body: JSON.stringify({ description: data.description, amount: data.amount, chargeType: 'MISC' }),
      }),
    onSuccess: (updatedRes, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reservations', selectedBranchId] });
      toast.success('Folio charge added successfully');
      setNewChargeForm({ description: '', amount: '' });
      if (checkoutReservation && checkoutReservation.id === variables.id && updatedRes) {
        setCheckoutReservation(updatedRes);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add folio charge');
    },
  });

  const removeChargeMutation = useMutation({
    mutationFn: async (data: { reservationId: string; chargeId: string; isService: boolean }) =>
      data.isService
        ? api<any>(`/services/${data.chargeId}`, { method: 'DELETE', token })
        : api<any>(`/hotel/reservations/${data.reservationId}/folio/${data.chargeId}`, { method: 'DELETE', token }),
    onSuccess: (updatedRes) => {
      queryClient.invalidateQueries({ queryKey: ['reservations', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Removed');
      if (updatedRes && updatedRes.id) setCheckoutReservation(updatedRes);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to remove'),
  });

  const updatePaymentMutation = useMutation({
    mutationFn: async (data: { id: string; amount: number; method: string; bankAccountId?: string }) =>
      api<any>(`/hotel/reservations/${data.id}/payments`, {
        method: 'POST',
        token,
        body: JSON.stringify({ method: data.method, amount: data.amount, bankAccountId: data.bankAccountId }),
      }),
    onSuccess: (updatedRes, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reservations', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['hotel-stats', selectedBranchId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Payment recorded successfully');
      setNewPaymentAmount('');
      setNewPaymentMethod('CASH');
      setNewPaymentBankId('');
      if (checkoutReservation && checkoutReservation.id === variables.id && updatedRes) {
        setCheckoutReservation(updatedRes);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment');
    },
  });

  const getReservationSummary = (r: Reservation) => {
    const nights = Math.max(
      1,
      Math.ceil(
        (new Date(r.checkOut).getTime() - new Date(r.checkIn).getTime()) / 86400000
      )
    );
    const roomSubtotal = Number(r.totalAmount || 0);
    const extraChargesTotal =
      (r.folioCharges?.reduce((sum, c) => sum + Number(c.amount || 0), 0) || 0) +
      (r.serviceRequests?.filter(sr => sr.status === 'COMPLETED').reduce((sum, sr) => sum + Number(sr.amount || 0), 0) || 0);
    const grandTotal = roomSubtotal + extraChargesTotal;
    const pendingDues = grandTotal - Number(r.paidAmount || 0);
    return {
      nights,
      roomSubtotal,
      extraChargesTotal,
      grandTotal,
      pendingDues,
    };
  };

  // Print the folio as a dedicated 80mm receipt document (opened in a new window), the same
  // robust path the POS thermal bill uses. This replaces window.print() of the live dialog,
  // which printed the modal's black overlay over the content (the "blank bill" bug).
  const printFolio = (r: Reservation) => {
    const s = getReservationSummary(r);
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const money = (n: unknown) => `Rs. ${Number(n || 0).toFixed(2)}`;
    const dt = (d: string) => new Date(d).toLocaleDateString('en-IN');
    const hotelName = branches?.find((b) => b.id === selectedBranchId)?.name || 'Hotel';
    const chargeRows = (r.folioCharges ?? [])
      .map((c) => `<tr><td>${esc(c.description)}</td><td class="r">${money(c.amount)}</td></tr>`)
      .join('');
    const serviceRows = (r.serviceRequests ?? [])
      .filter((sr: { status?: string; amount?: unknown }) => sr.status === 'COMPLETED' && sr.amount)
      .map((sr: { serviceType?: string; description?: string; amount?: unknown }) =>
        `<tr><td>${esc((sr.serviceType || 'Service').replace('_', ' '))}</td><td class="r">${money(sr.amount)}</td></tr>`)
      .join('');
    const paymentRows = (r.folioPayments ?? [])
      .map((p) => `<tr><td>Paid via ${esc(PAYMENT_METHOD_LABELS[p.method] || p.method)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td class="r">${money(p.amount)}</td></tr>`)
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Folio ${esc(r.bookingRef)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', ui-monospace, monospace; width: 80mm; margin: 0 auto; padding: 4mm; color: #000; font-size: 12px; line-height: 1.45; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
  .muted { text-align: center; color: #333; font-size: 11px; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .r { text-align: right; }
  .total td { font-weight: 700; font-size: 14px; border-top: 1px solid #000; padding-top: 4px; }
</style></head><body>
  <h1>${esc(hotelName)}</h1>
  <div class="muted">Guest Folio / Invoice</div>
  <div class="divider"></div>
  <table>
    <tr><td>Guest</td><td class="r">${esc(r.guest.firstName)} ${esc(r.guest.lastName)}</td></tr>
    <tr><td>Booking</td><td class="r">${esc(r.bookingRef)}</td></tr>
    <tr><td>Room</td><td class="r">${esc(r.room?.roomNumber || '')}</td></tr>
    <tr><td>Check-in</td><td class="r">${dt(r.checkIn)}</td></tr>
    <tr><td>Check-out</td><td class="r">${dt(r.checkOut)}</td></tr>
    <tr><td>Nights</td><td class="r">${s.nights}</td></tr>
  </table>
  <div class="divider"></div>
  <table>
    <tr><td>Room charges (${s.nights} night${s.nights > 1 ? 's' : ''})</td><td class="r">${money(s.roomSubtotal)}</td></tr>
    ${chargeRows}${serviceRows}
  </table>
  <div class="divider"></div>
  <table>
    <tr class="total"><td>TOTAL</td><td class="r">${money(s.grandTotal)}</td></tr>
    <tr><td>Amount paid</td><td class="r">${money(r.paidAmount)}</td></tr>
    ${paymentRows}
    <tr class="total"><td>${s.pendingDues > 0 ? 'BALANCE DUE' : 'BALANCE'}</td><td class="r">${money(s.pendingDues)}</td></tr>
  </table>
  <div class="divider"></div>
  <div class="muted">Thank you for staying with us!</div>
</body></html>`;
    if (printHtmlDocument(html)) toast.success('Bill sent to printer');
  };

  const checkAvailability = () => {
    if (!rooms) return;
    const start = new Date(availCheckIn);
    const end = new Date(availCheckOut);
    if (start >= end) {
      toast.error('Check-out date must be after check-in date');
      return;
    }

    // Filter rooms where there are no overlapping reservations
    const vacantRooms = rooms.filter((room) => {
      const overlaps = reservations?.some((res) => {
        if (res.status === 'CANCELLED' || res.room.roomNumber !== room.roomNumber) return false;
        const resStart = new Date(res.checkIn);
        const resEnd = new Date(res.checkOut);
        return resStart < end && resEnd > start;
      });
      return !overlaps;
    });

    setAvailabilityResults(vacantRooms);
    setHasSearched(true);
  };

  const createRoomMutation = useMutation({
    mutationFn: async (data: Omit<RoomForm, 'id'> & { price?: number }) =>
      api<HotelRoom>(`/hotel/rooms${selectedBranchId ? `?branchId=${selectedBranchId}` : ''}`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          roomNumber: data.roomNumber,
          categoryId: data.categoryId,
          floor: data.floor ? Number(data.floor) : undefined,
          notes: data.notes,
          status: data.status,
          price: data.price,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', selectedBranchId] });
      toast.success('Room added successfully');
      setRoomDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add room');
    },
  });

  const updateRoomMutation = useMutation({
    mutationFn: async (data: RoomForm) =>
      api<HotelRoom>(`/hotel/rooms/${data.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          roomNumber: data.roomNumber,
          categoryId: data.categoryId,
          floor: data.floor ? Number(data.floor) : undefined,
          notes: data.notes,
          status: data.status,
          price: data.price ? Number(data.price) : null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', selectedBranchId] });
      setRoomDialogOpen(false);
      toast.success('Room updated successfully');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update room');
    },
  });

  const openNewRoom = () => {
    setEditingRoom(null);
    setRoomForm({
      ...initialRoomForm,
      categoryId: categories?.[0]?.id ?? '',
      price: '',
    });
    setRoomDialogOpen(true);
  };

  const openEditRoom = (room: HotelRoom) => {
    setEditingRoom(room);
    setRoomForm({
      id: room.id,
      roomNumber: room.roomNumber,
      categoryId: room.category.id,
      floor: room.floor?.toString() ?? '',
      notes: room.notes ?? '',
      status: room.status,
      price: room.price?.toString() ?? '',
    });
    setRoomDialogOpen(true);
  };

  const handleRoomSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = {
      roomNumber: roomForm.roomNumber,
      categoryId: roomForm.categoryId,
      floor: roomForm.floor,
      notes: roomForm.notes,
      status: roomForm.status,
      price: roomForm.price ? Number(roomForm.price) : undefined,
    } as Omit<RoomForm, 'id'> & { price?: number };

    if (editingRoom) {
      await updateRoomMutation.mutateAsync({ ...(payload as RoomForm), id: editingRoom.id });
      setEditingRoom(null);
    } else {
      await createRoomMutation.mutateAsync(payload);
    }
  };

  const selectedCategory = useMemo(
    () => categories?.find((category) => category.id === roomForm.categoryId),
    [categories, roomForm.categoryId],
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header & Branch Switcher */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-4 rounded-xl border border-white/5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building className="h-6 w-6 text-primary" />
            Hotel PMS
          </h1>
          <p className="text-xs text-muted-foreground">Manage multiple property branches, availability & reservations</p>
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

          <Button variant="outline" size="sm" onClick={() => setNewBranchOpen(true)}>
            + Add Hotel
          </Button>

          <div className="h-4 w-px bg-white/10 hidden md:block" />

          <Button variant="outline" size="sm" onClick={() => router.push(`/hotel/dashboard?branchId=${selectedBranchId}`)}>Dashboard</Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/hotel/guests?branchId=${selectedBranchId}`)}>Guests</Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/hotel/expenses?branchId=${selectedBranchId}`)}>Expenses</Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/hotel/check-in?branchId=${selectedBranchId}`)}>Walk-in</Button>
          <Button size="sm" onClick={openNewRoom}>Add Room</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-2">
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-all',
            activeTab === 'rooms' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('rooms')}
        >
          Room Grid
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-all',
            activeTab === 'calendar' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('calendar')}
        >
          Occupancy Timeline
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-all',
            activeTab === 'availability' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('availability')}
        >
          Room Availability Finder
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-all',
            activeTab === 'reservations' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('reservations')}
        >
          Bookings & Cancellations
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          <ReservationCalendar
            branchId={selectedBranchId}
            rooms={rooms || []}
            reservations={reservations || []}
            onCheckInClick={(roomId, dateStr) => {
              router.push(`/hotel/check-in?roomId=${roomId}&checkIn=${dateStr}&branchId=${selectedBranchId}`);
            }}
            onManageClick={(reservation) => {
              setCheckoutReservation(reservation);
              setCheckoutDialogOpen(true);
            }}
          />
        </div>
      )}

      {activeTab === 'rooms' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-lg">Room Grid ({rooms?.length || 0} Rooms)</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {rooms?.map((room) => (
              <Card
                key={room.id}
                className={cn('p-4 border-2 hover:shadow-md transition-shadow flex flex-col justify-between min-h-[160px]', STATUS_COLORS[room.status])}
              >
                <div>
                  <div className="flex justify-between items-start">
                    <p className="text-2xl font-black tracking-tight">{room.roomNumber}</p>
                    <span className="text-xs opacity-75">{room.floor ? `Floor ${room.floor}` : ''}</span>
                  </div>
                  <p className="text-xs opacity-85 mt-0.5 uppercase font-semibold">{room.category.name}</p>
                  <p className="text-xs mt-1 font-mono font-medium">{formatCurrency(Number(room.price ?? room.category.basePrice))}/night</p>
                  <p className="text-xs mt-2 text-muted-foreground line-clamp-2">
                    {room.notes || room.category.description || 'No description'}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between pt-2 border-t border-dashed border-black/10 dark:border-white/10">
                  <span className="text-xs font-bold uppercase tracking-wider">{room.status}</span>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openEditRoom(room)}>
                    Manage
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'availability' && (
        <div className="space-y-6">
          <Card className="p-5 border-white/5 space-y-4 max-w-4xl">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">Find Vacant Rooms</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
              <label className="space-y-2 flex flex-col">
                <span className="text-xs font-medium text-muted-foreground">Check-in Date</span>
                <input
                  type="date"
                  className="rounded-lg border border-white/10 px-3 py-2 bg-background text-sm text-foreground focus:outline-none focus:border-primary"
                  value={availCheckIn}
                  onChange={(e) => setAvailCheckIn(e.target.value)}
                />
              </label>
              <label className="space-y-2 flex flex-col">
                <span className="text-xs font-medium text-muted-foreground">Check-out Date</span>
                <input
                  type="date"
                  className="rounded-lg border border-white/10 px-3 py-2 bg-background text-sm text-foreground focus:outline-none focus:border-primary"
                  value={availCheckOut}
                  onChange={(e) => setAvailCheckOut(e.target.value)}
                />
              </label>
              <Button onClick={checkAvailability} className="w-full">
                <Search className="h-4 w-4 mr-2" /> Search Vacancy
              </Button>
            </div>
          </Card>

          {hasSearched && (
            <div className="space-y-4">
              <h4 className="font-semibold text-lg">Vacant Rooms Found ({availabilityResults.length})</h4>
              {availabilityResults.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {availabilityResults.map((room) => (
                    <Card key={room.id} className="p-4 border border-white/5 flex flex-col justify-between bg-card text-foreground">
                      <div>
                        <div className="flex justify-between items-start">
                          <p className="text-xl font-bold">{room.roomNumber}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Vacant</span>
                        </div>
                        <p className="text-xs text-muted-foreground font-semibold uppercase mt-1">{room.category.name}</p>
                        <p className="text-sm font-bold text-primary mt-2">{formatCurrency(Number(room.price ?? room.category.basePrice))}/night</p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-white/5 flex justify-between items-center gap-2">
                        <span className="text-xs text-muted-foreground">{room.floor ? `Floor ${room.floor}` : 'Floor not set'}</span>
                        <Button
                          size="sm"
                          onClick={() => router.push(`/hotel/check-in?roomId=${room.id}&checkIn=${availCheckIn}&checkOut=${availCheckOut}&rate=${room.price ?? room.category.basePrice}&branchId=${selectedBranchId}`)}
                        >
                          Book / Check In
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="p-8 border border-dashed border-white/10 rounded-xl text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                  No rooms are fully vacant for the selected dates.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'reservations' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <h2 className="font-semibold text-lg">Booking & Reservation Log</h2>
            <div className="flex bg-muted/40 border border-white/5 p-1 rounded-lg shrink-0">
              <Button
                variant={reservationSubTab === 'active' ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs h-8 px-3 font-semibold rounded-md"
                onClick={() => setReservationSubTab('active')}
              >
                Current / Active
              </Button>
              <Button
                variant={reservationSubTab === 'history' ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs h-8 px-3 font-semibold rounded-md"
                onClick={() => setReservationSubTab('history')}
              >
                Past & Checked-Out
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {(() => {
              const filtered = (reservations || []).filter((r) => {
                if (reservationSubTab === 'active') {
                  return r.status === 'CONFIRMED' || r.status === 'CHECKED_IN';
                } else {
                  return r.status === 'CHECKED_OUT' || r.status === 'CANCELLED';
                }
              });

              return filtered.length > 0 ? (
                filtered.map((r) => {
                  const summary = getReservationSummary(r);
                  return (
                    <Card key={r.id} className="p-5 border border-white/5 flex flex-col justify-between bg-card text-foreground relative overflow-hidden group">
                      <div className="space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-secondary text-secondary-foreground font-mono">
                              {r.bookingRef}
                            </span>
                            <h4 className="font-bold text-base mt-2">{r.guest.firstName} {r.guest.lastName}</h4>
                          </div>
                          <span className={cn('text-xs font-bold px-2 py-1 rounded-full border', 
                            r.status === 'CONFIRMED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            r.status === 'CHECKED_IN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            r.status === 'CHECKED_OUT' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                            'bg-gray-500/10 text-gray-400 border-gray-500/20'
                          )}>
                            {r.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 py-2 border-y border-white/5 text-xs text-muted-foreground">
                          <div>
                            <p className="font-medium text-foreground">Room Number</p>
                            <p className="font-bold text-sm text-primary mt-0.5">Room {r.room?.roomNumber || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">Financial Summary</p>
                            <p className="mt-0.5 font-bold">
                              Paid: {formatCurrency(Number(r.paidAmount))} / {formatCurrency(summary.grandTotal)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>In: {new Date(r.checkIn).toLocaleDateString()}</span>
                          <span>Out: {new Date(r.checkOut).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-white/5 flex flex-col gap-2">
                        <div className="flex justify-between items-center text-xs">
                          {r.guest.documentPublicUrl ? (
                            <a href={r.guest.documentPublicUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
                              View ID ({r.guest.idProofType || 'Proof'})
                            </a>
                          ) : (
                            <span className="text-muted-foreground italic">No ID uploaded</span>
                          )}
                          {summary.pendingDues > 0 && r.status !== 'CHECKED_OUT' && r.status !== 'CANCELLED' && (
                            <span className="text-rose-500 font-semibold font-mono">
                              Due: {formatCurrency(summary.pendingDues)}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {r.status === 'CONFIRMED' && (
                            <Button
                              size="sm"
                              className="flex-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={checkInReservationMutation.isPending}
                              onClick={() => checkInReservationMutation.mutate(r.id)}
                            >
                              Check In
                            </Button>
                          )}

                          {r.status === 'CHECKED_IN' && (
                            <Button
                              size="sm"
                              className="flex-1 text-xs font-semibold bg-primary text-primary-foreground"
                              onClick={() => {
                                setCheckoutReservation(r);
                                setCheckoutDialogOpen(true);
                              }}
                            >
                              Check Out & Bill
                            </Button>
                          )}

                          {r.status === 'CHECKED_OUT' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 text-xs font-semibold"
                              onClick={() => {
                                setCheckoutReservation(r);
                                setCheckoutDialogOpen(true);
                              }}
                            >
                              View Invoice
                            </Button>
                          )}

                          {r.status !== 'CANCELLED' && r.status !== 'CHECKED_OUT' && (
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8 text-xs font-semibold"
                              onClick={() => {
                                setCancelReservationId(r.id);
                                setRefundAmount(Number(r.paidAmount));
                                setCancelDialogOpen(true);
                              }}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground col-span-full py-12 text-center border border-dashed border-white/10 rounded-xl">
                  {reservationSubTab === 'active' 
                    ? 'No current or active bookings found for this branch.' 
                    : 'No past check-outs or cancelled bookings found.'}
                </p>
              );
            })()}
          </div>
        </div>
      )}

      {/* Add Room Dialog */}
      <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
        <DialogContent className="sm:max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>{editingRoom ? 'Edit Room' : 'Add Room'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRoomSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium">Room number</span>
                <input
                  className="w-full rounded-lg border px-3 py-2 bg-background/50"
                  required
                  value={roomForm.roomNumber}
                  onChange={(e) => setRoomForm({ ...roomForm, roomNumber: e.target.value })}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Category</span>
                <select
                  className="w-full h-10 rounded-lg border px-3 bg-background"
                  required
                  value={roomForm.categoryId}
                  onChange={(e) => setRoomForm({ ...roomForm, categoryId: e.target.value })}
                >
                  <option value="">Select category</option>
                  {categories?.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="space-y-2">
                <span className="text-sm font-medium">Floor</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border px-3 py-2 bg-background/50"
                  value={roomForm.floor}
                  onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Price Override (₹)</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="w-full rounded-lg border px-3 py-2 bg-background/50"
                  placeholder={selectedCategory ? `${selectedCategory.basePrice} (default)` : 'e.g. 3500'}
                  value={roomForm.price}
                  onChange={(e) => setRoomForm({ ...roomForm, price: e.target.value })}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Status</span>
                <select
                  className="w-full h-10 rounded-lg border px-3 bg-background"
                  value={roomForm.status}
                  onChange={(e) => setRoomForm({ ...roomForm, status: e.target.value })}
                >
                  {ROOM_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-medium">Room description / notes</span>
              <textarea
                rows={4}
                className="w-full rounded-lg border px-3 py-2 bg-background/50"
                value={roomForm.notes}
                onChange={(e) => setRoomForm({ ...roomForm, notes: e.target.value })}
                placeholder="Enter room setup details, amenities, cleaning notes or guest instructions"
              />
            </label>

            {selectedCategory?.description && (
              <div className="rounded-xl border border-muted p-3 bg-muted/50 text-sm text-muted-foreground">
                <strong>Category details:</strong> {selectedCategory.description}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={createRoomMutation.isPending || updateRoomMutation.isPending}>
                {editingRoom ? 'Save changes' : 'Create room'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Hotel Branch Dialog */}
      <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Hotel Branch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Hotel/Branch Name</span>
              <input
                className="w-full rounded-lg border border-white/10 px-3 py-2 bg-background/50 text-sm"
                placeholder="e.g. Grand Plaza Resort"
                value={newBranchForm.name}
                onChange={(e) => setNewBranchForm({ ...newBranchForm, name: e.target.value })}
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Branch Code</span>
              <input
                className="w-full rounded-lg border border-white/10 px-3 py-2 bg-background/50 text-sm"
                placeholder="e.g. GPR01"
                value={newBranchForm.code}
                onChange={(e) => setNewBranchForm({ ...newBranchForm, code: e.target.value })}
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Address</span>
              <input
                className="w-full rounded-lg border border-white/10 px-3 py-2 bg-background/50 text-sm"
                placeholder="e.g. 102 Beach Road, Goa"
                value={newBranchForm.address}
                onChange={(e) => setNewBranchForm({ ...newBranchForm, address: e.target.value })}
              />
            </label>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setNewBranchOpen(false)}>
                Cancel
              </Button>
              <Button 
                className="flex-1" 
                disabled={createBranchMutation.isPending}
                onClick={() => {
                  if (!newBranchForm.name || !newBranchForm.code) {
                    toast.error('Name and Code are required');
                    return;
                  }
                  createBranchMutation.mutate(newBranchForm);
                }}
              >
                Create Branch
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Reservation & Refund Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Booking & Process Refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-xs rounded-lg text-red-400 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Important Action</p>
                <p className="mt-0.5">Cancelling this booking will reverse the room occupancy state to AVAILABLE and release it back into vacancy pools.</p>
              </div>
            </div>

            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Cancellation Fee</span>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">₹</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-white/10 pl-7 pr-3 py-2 bg-background/50 text-sm"
                  value={cancellationFee}
                  onChange={(e) => setCancellationFee(parseFloat(e.target.value) || 0)}
                />
              </div>
            </label>

            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">Refund Amount</span>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">₹</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-white/10 pl-7 pr-3 py-2 bg-background/50 text-sm"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(parseFloat(e.target.value) || 0)}
                />
              </div>
            </label>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setCancelDialogOpen(false)}>
                Go Back
              </Button>
              <Button
                variant="destructive"
                className="flex-1 font-semibold"
                disabled={cancelReservationMutation.isPending}
                onClick={() => {
                  if (cancelReservationId) {
                    cancelReservationMutation.mutate({
                      id: cancelReservationId,
                      cancellationFee,
                      refundAmount,
                    });
                  }
                }}
              >
                Confirm Cancellation
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Checkout and Folio Dialog */}
      <Dialog open={checkoutDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setCheckoutDialogOpen(false);
          setCheckoutReservation(null);
        }
      }}>
        <DialogContent className="sm:max-w-xl w-full max-h-[90vh] !flex flex-col !p-0 !gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
            <DialogTitle>
              {checkoutReservation?.status === 'CHECKED_OUT' ? 'Booking Invoice' : 'Guest Check-Out & Folio Bill'}
            </DialogTitle>
          </DialogHeader>

          {checkoutReservation && (() => {
            const summary = getReservationSummary(checkoutReservation);
            return (
              <>
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-3 space-y-4">
                {/* Guest & Reservation Header */}
                <div className="bg-muted/50 p-3 rounded-lg border border-white/5 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block">GUEST NAME</span>
                    <span className="font-semibold text-sm">{checkoutReservation.guest.firstName} {checkoutReservation.guest.lastName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">BOOKING REF</span>
                    <span className="font-mono font-semibold text-sm">{checkoutReservation.bookingRef}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">ROOM NUMBER</span>
                    <span className="font-semibold text-sm text-primary">Room {checkoutReservation.room?.roomNumber || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">STAY DURATION</span>
                    <span className="font-semibold text-sm">{summary.nights} {summary.nights === 1 ? 'Night' : 'Nights'}</span>
                  </div>
                  <div className="col-span-2 pt-1 border-t border-white/5 flex justify-between text-muted-foreground">
                    <span>In: {new Date(checkoutReservation.checkIn).toLocaleDateString()}</span>
                    <span>Out: {new Date(checkoutReservation.checkOut).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Folio Breakdown */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Itemized Folio Details</h4>
                  <div className="border border-white/10 rounded-lg overflow-hidden bg-background divide-y divide-white/5 text-sm">
                    {/* Room Rent Row */}
                    <div className="flex justify-between items-center p-2.5">
                      <div>
                        <span className="font-semibold">Room Lodging Charge</span>
                        <span className="text-xs text-muted-foreground block">{summary.nights} night(s) @ {formatCurrency(Number(checkoutReservation.totalAmount) / summary.nights)} / night</span>
                      </div>
                      <span className="font-mono font-semibold">{formatCurrency(summary.roomSubtotal)}</span>
                    </div>

                     {/* Folio Charges Rows */}
                    {(() => {
                      const charges = [
                        ...(checkoutReservation.folioCharges || []).map((c: any) => ({
                          id: c.id, description: c.description, chargeType: c.chargeType, createdAt: c.createdAt, amount: c.amount, isService: false,
                        })),
                        ...((checkoutReservation.serviceRequests || [])
                          .filter((sr: any) => sr.status === 'COMPLETED')
                          .map((sr: any) => ({
                            id: sr.id,
                            description: `${sr.serviceType.replace('_', ' ')}: ${sr.description || 'Request'}`,
                            chargeType: 'SERVICE',
                            createdAt: sr.completedAt || sr.createdAt,
                            amount: sr.amount,
                            isService: true,
                          })))
                      ];
                      const canRemove = checkoutReservation.status === 'CHECKED_IN';

                      return charges.length > 0 ? (
                        charges.map((charge) => (
                          <div key={charge.id} className="flex justify-between items-center p-2.5 bg-muted/20 gap-2">
                            <div className="min-w-0">
                              <span className="font-medium text-foreground">{charge.description}</span>
                              <span className="text-[10px] text-muted-foreground uppercase block">{charge.chargeType} • {new Date(charge.createdAt).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono font-semibold text-muted-foreground">{formatCurrency(Number(charge.amount))}</span>
                              {canRemove && (
                                <button
                                  type="button"
                                  title="Remove"
                                  className="text-muted-foreground hover:text-destructive text-sm px-1"
                                  disabled={removeChargeMutation.isPending}
                                  onClick={() => { if (confirm('Remove this charge?')) removeChargeMutation.mutate({ reservationId: checkoutReservation.id, chargeId: charge.id, isService: charge.isService }); }}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-3 text-center text-xs text-muted-foreground italic">
                          No additional room service or custom charges added.
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Add Folio Charge Form (Only during stay) */}
                {checkoutReservation.status === 'CHECKED_IN' && (
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newChargeForm.description || !newChargeForm.amount) return;
                      addFolioChargeMutation.mutate({
                        id: checkoutReservation.id,
                        description: newChargeForm.description,
                        amount: parseFloat(newChargeForm.amount),
                      });
                    }}
                    className="p-3 bg-muted/40 rounded-lg border border-white/5 space-y-2"
                  >
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">Add Extra Charge (Sodexo, F&B, Services)</span>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded-lg border px-2.5 py-1.5 bg-background text-xs"
                        placeholder="Description (e.g. Laundry)"
                        required
                        value={newChargeForm.description}
                        onChange={(e) => setNewChargeForm({ ...newChargeForm, description: e.target.value })}
                      />
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className="w-24 rounded-lg border px-2.5 py-1.5 bg-background text-xs"
                        placeholder="Amount"
                        required
                        value={newChargeForm.amount}
                        onChange={(e) => setNewChargeForm({ ...newChargeForm, amount: e.target.value })}
                      />
                      <Button type="submit" size="sm" className="text-xs shrink-0" disabled={addFolioChargeMutation.isPending}>
                        Add
                      </Button>
                    </div>
                  </form>
                )}

                {/* Record Payment Form (Only during stay/pending dues) */}
                {checkoutReservation.status === 'CHECKED_IN' && summary.pendingDues > 0 && (
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      const payVal = parseFloat(newPaymentAmount || '0');
                      if (payVal <= 0) return;
                      if (newPaymentMethod !== 'CASH' && !newPaymentBankId) { toast.error('Select a bank account'); return; }
                      updatePaymentMutation.mutate({
                        id: checkoutReservation.id,
                        amount: payVal,
                        method: newPaymentMethod,
                        bankAccountId: newPaymentMethod !== 'CASH' ? newPaymentBankId : undefined,
                      });
                    }}
                    className="p-3 bg-muted/40 rounded-lg border border-white/5 space-y-2"
                  >
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">Record Guest Payment</span>
                    <div className="flex gap-2">
                      <select
                        className="rounded-lg border px-2 py-1.5 bg-background text-xs shrink-0"
                        value={newPaymentMethod}
                        onChange={(e) => setNewPaymentMethod(e.target.value)}
                      >
                        <option value="CASH">Cash</option>
                        <option value="BANK">Bank Transfer</option>
                        <option value="UPI">UPI</option>
                        <option value="CARD">Card</option>
                      </select>
                      {newPaymentMethod !== 'CASH' && (
                        <select
                          className="rounded-lg border px-2 py-1.5 bg-background text-xs shrink-0 max-w-[40%]"
                          value={newPaymentBankId}
                          onChange={(e) => setNewPaymentBankId(e.target.value)}
                        >
                          <option value="">Bank account…</option>
                          {(bankAccounts ?? []).filter((a) => a.accountType !== 'CASH').map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-2 text-xs text-muted-foreground">₹</span>
                        <input
                          type="number"
                          min={0}
                          max={summary.pendingDues}
                          step="any"
                          className="w-full rounded-lg border pl-7 pr-3 py-1.5 bg-background text-xs"
                          placeholder={`Enter amount (max ₹${summary.pendingDues})`}
                          required
                          value={newPaymentAmount}
                          onChange={(e) => setNewPaymentAmount(e.target.value)}
                        />
                      </div>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        className="text-xs shrink-0"
                        onClick={() => setNewPaymentAmount(summary.pendingDues.toString())}
                      >
                        Auto-Fill Due
                      </Button>
                      <Button type="submit" size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white shrink-0" disabled={updatePaymentMutation.isPending}>
                        Pay
                      </Button>
                    </div>
                  </form>
                )}

                {/* Totals Bar */}
                <div className="border-t border-white/10 pt-3 flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Bill (Lodging + Services)</span>
                    <span className="font-mono font-semibold">{formatCurrency(summary.grandTotal)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-500 font-semibold">
                    <span>Total Amount Paid</span>
                    <span className="font-mono">{formatCurrency(Number(checkoutReservation.paidAmount))}</span>
                  </div>
                  {(checkoutReservation.folioPayments?.length ?? 0) > 0 && (
                    <div className="text-xs text-muted-foreground pl-2 space-y-0.5">
                      {checkoutReservation.folioPayments!.map((p) => (
                        <div key={p.id} className="flex justify-between">
                          <span>Paid via {PAYMENT_METHOD_LABELS[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                          <span className="font-mono">{formatCurrency(Number(p.amount))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between border-t border-dashed border-white/10 pt-2 text-base font-bold">
                    <span>{summary.pendingDues > 0 ? 'Remaining Balance' : 'Balance Cleared'}</span>
                    <span className={cn('font-mono', summary.pendingDues > 0 ? 'text-rose-500' : 'text-emerald-500')}>
                      {formatCurrency(summary.pendingDues)}
                    </span>
                  </div>
                </div>

                </div>
                {/* Bottom Actions — fixed footer, always visible without scrolling. print:hidden so the
                    "Print Bill"/checkout buttons don't appear on the printed receipt. */}
                <div className="flex gap-2 px-6 py-3 border-t bg-card shrink-0 print:hidden">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => printFolio(checkoutReservation)}
                  >
                    Print Bill
                  </Button>
                  
                  {checkoutReservation.status === 'CHECKED_IN' && (() => {
                    const splitSum = splitRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
                    const dueLeft = summary.pendingDues - splitSum;
                    const splitValid =
                      Math.abs(dueLeft) < 0.01 &&
                      splitRows.every((r) => (parseFloat(r.amount) || 0) > 0 && (r.method === 'CASH' || r.bankAccountId));
                    const banks = (bankAccounts ?? []).filter((a) => a.accountType !== 'CASH');
                    const updateRow = (idx: number, patch: Partial<(typeof splitRows)[number]>) =>
                      setSplitRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
                    return (
                    <div className="flex-1 flex flex-col gap-2">
                      {summary.pendingDues > 0 && (
                        <>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Pay by:</span>
                            <button type="button" className={cn('px-2 py-0.5 rounded border', !checkoutSplit && 'bg-primary text-primary-foreground border-primary')} onClick={() => setCheckoutSplit(false)}>Single</button>
                            <button type="button" className={cn('px-2 py-0.5 rounded border', checkoutSplit && 'bg-primary text-primary-foreground border-primary')} onClick={() => setCheckoutSplit(true)}>Split</button>
                          </div>
                          {!checkoutSplit ? (
                            <div className="flex gap-2">
                              <select
                                className="rounded-lg border px-2 py-1.5 bg-background text-xs shrink-0"
                                value={checkoutMethod}
                                onChange={(e) => setCheckoutMethod(e.target.value)}
                              >
                                <option value="CASH">Cash</option>
                                <option value="BANK">Bank Transfer</option>
                                <option value="UPI">UPI</option>
                                <option value="CARD">Card</option>
                              </select>
                              {checkoutMethod !== 'CASH' && (
                                <select
                                  className="rounded-lg border px-2 py-1.5 bg-background text-xs flex-1 min-w-0"
                                  value={checkoutBankId}
                                  onChange={(e) => setCheckoutBankId(e.target.value)}
                                >
                                  <option value="">Bank account…</option>
                                  {banks.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
                                </select>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {splitRows.map((r, idx) => (
                                <div key={idx} className="flex gap-1.5 items-center">
                                  <select
                                    className="rounded-lg border px-1.5 py-1.5 bg-background text-xs shrink-0"
                                    value={r.method}
                                    onChange={(e) => updateRow(idx, { method: e.target.value, bankAccountId: '' })}
                                  >
                                    <option value="CASH">Cash</option>
                                    <option value="BANK">Bank Transfer</option>
                                    <option value="UPI">UPI</option>
                                    <option value="CARD">Card</option>
                                  </select>
                                  {r.method !== 'CASH' && (
                                    <select
                                      className="rounded-lg border px-1.5 py-1.5 bg-background text-xs flex-1 min-w-0"
                                      value={r.bankAccountId}
                                      onChange={(e) => updateRow(idx, { bankAccountId: e.target.value })}
                                    >
                                      <option value="">Bank…</option>
                                      {banks.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
                                    </select>
                                  )}
                                  <input
                                    type="number" min={0} step="any" placeholder="Amount"
                                    className="w-20 rounded-lg border px-2 py-1.5 bg-background text-xs"
                                    value={r.amount}
                                    onChange={(e) => updateRow(idx, { amount: e.target.value })}
                                  />
                                  {splitRows.length > 1 && (
                                    <button type="button" className="text-muted-foreground hover:text-rose-600 text-sm px-1" onClick={() => setSplitRows((rows) => rows.filter((_, i) => i !== idx))}>✕</button>
                                  )}
                                </div>
                              ))}
                              <div className="flex justify-between items-center text-xs">
                                <button type="button" className="text-primary hover:underline" onClick={() => setSplitRows((rows) => [...rows, { method: 'CASH', amount: '', bankAccountId: '' }])}>+ Add method</button>
                                <span className={cn('font-medium', Math.abs(dueLeft) < 0.01 ? 'text-emerald-600' : 'text-rose-600')}>
                                  {dueLeft > 0.009 ? `${formatCurrency(dueLeft)} left` : dueLeft < -0.009 ? `${formatCurrency(-dueLeft)} over` : 'Balanced ✓'}
                                </span>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      <Button
                        className="w-full bg-rose-600 hover:bg-rose-700 text-white"
                        disabled={checkoutMutation.isPending || (summary.pendingDues > 0 && checkoutSplit && !splitValid)}
                        onClick={() => {
                          if (summary.pendingDues > 0) {
                            if (checkoutSplit) {
                              checkoutMutation.mutate({
                                id: checkoutReservation.id,
                                settle: {
                                  payments: splitRows.map((r) => ({
                                    method: r.method,
                                    amount: parseFloat(r.amount) || 0,
                                    bankAccountId: r.method !== 'CASH' ? r.bankAccountId : undefined,
                                  })),
                                },
                              });
                            } else {
                              if (checkoutMethod !== 'CASH' && !checkoutBankId) {
                                toast.error('Select a bank account');
                                return;
                              }
                              checkoutMutation.mutate({
                                id: checkoutReservation.id,
                                settle: {
                                  method: checkoutMethod,
                                  amount: summary.pendingDues,
                                  bankAccountId: checkoutMethod !== 'CASH' ? checkoutBankId : undefined,
                                },
                              });
                            }
                          } else {
                            checkoutMutation.mutate({ id: checkoutReservation.id });
                          }
                        }}
                      >
                        {summary.pendingDues > 0
                          ? `Settle ${formatCurrency(summary.pendingDues)} & Checkout`
                          : 'Complete Checkout'}
                      </Button>
                      {summary.pendingDues > 0 && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                          disabled={checkoutMutation.isPending}
                          onClick={() => {
                            if (confirm(`Checkout with ₹${summary.pendingDues} still due (no payment recorded)?`)) {
                              checkoutMutation.mutate({ id: checkoutReservation.id });
                            }
                          }}
                        >
                          Skip payment &amp; checkout with balance due
                        </button>
                      )}
                    </div>
                    );
                  })()}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
