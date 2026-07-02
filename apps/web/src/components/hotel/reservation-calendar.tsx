'use client';

import { useState } from 'react';
import { cn, formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Calendar as CalendarIcon, 
  User, 
  Clock, 
  CreditCard,
  Layers,
  Activity
} from 'lucide-react';

interface FolioCharge {
  id: string;
  description: string;
  amount: number | string;
  chargeType: string;
  createdAt: string;
}

interface Reservation {
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
  serviceRequests?: any[];
}

interface HotelRoom {
  id: string;
  roomNumber: string;
  status: string;
  floor?: number;
  notes?: string | null;
  price?: number | string | null;
  category: { id: string; name: string; basePrice: number; description?: string | null };
}

interface ReservationCalendarProps {
  branchId: string;
  rooms: HotelRoom[];
  reservations: Reservation[];
  onCheckInClick: (roomId: string, checkInDate: string) => void;
  onManageClick: (reservation: Reservation) => void;
}

const STATUS_GRADIENTS: Record<string, string> = {
  CONFIRMED: 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 text-amber-300 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.05)]',
  CHECKED_IN: 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 hover:from-emerald-500/30 hover:to-teal-500/30 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.05)]',
  CHECKED_OUT: 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 hover:from-blue-500/20 hover:to-indigo-500/20 text-slate-400 border border-slate-700/50 shadow-none opacity-60',
  CANCELLED: 'bg-gradient-to-r from-rose-500/10 to-red-500/10 text-rose-400 border border-rose-500/20 opacity-50 line-through',
};

const STATUS_BADGES: Record<string, string> = {
  CONFIRMED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  CHECKED_IN: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  CHECKED_OUT: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  CANCELLED: 'bg-red-500/20 text-red-300 border-red-500/30',
};

export function ReservationCalendar({
  branchId,
  rooms,
  reservations,
  onCheckInClick,
  onManageClick,
}: ReservationCalendarProps) {
  const [startDate, setStartDate] = useState<Date>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });

  // Calculate 14 days starting from startDate
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const changeStartDate = (offsetDays: number) => {
    const nextDate = new Date(startDate);
    nextDate.setDate(startDate.getDate() + offsetDays);
    setStartDate(nextDate);
  };

  const setToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setStartDate(today);
  };

  // Helper to check if a reservation covers a specific night
  const getReservationForNight = (roomId: string, date: Date) => {
    return reservations.find((r) => {
      if (r.room?.id !== roomId) return false;
      if (r.status === 'CANCELLED') return false;

      const checkInDate = new Date(r.checkIn);
      checkInDate.setHours(0, 0, 0, 0);
      const checkOutDate = new Date(r.checkOut);
      checkOutDate.setHours(0, 0, 0, 0);

      // Night starts on checkIn afternoon and ends checkOut morning
      return date >= checkInDate && date < checkOutDate;
    });
  };

  return (
    <div className="space-y-4">
      {/* Calendar Header Toggles */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-900/60 p-3 rounded-xl border border-white/5 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => changeStartDate(-14)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Prev 2 Weeks
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => changeStartDate(-7)}>
            <ChevronLeft className="h-3 w-3 mr-0.5" /> Prev Week
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={setToday}>
            Today
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => changeStartDate(7)}>
            Next Week <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs font-semibold" onClick={() => changeStartDate(14)}>
            Next 2 Weeks <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 bg-slate-950/60 border border-white/10 px-3 py-1.5 rounded-lg w-full sm:w-auto">
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              className="bg-transparent border-0 outline-none text-xs font-semibold w-full sm:w-36 text-white"
              value={startDate.toISOString().split('T')[0]}
              onChange={(e) => {
                if (e.target.value) {
                  const d = new Date(e.target.value);
                  d.setHours(0, 0, 0, 0);
                  setStartDate(d);
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Timeline Grid */}
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950/50 backdrop-blur-md shadow-2xl">
        <table className="w-full text-sm min-w-[1200px] border-collapse">
          <thead>
            <tr className="border-b border-white/10 bg-slate-900/80">
              <th className="p-4 text-left font-bold text-slate-300 w-60 sticky left-0 bg-slate-900 z-10 border-r border-white/10">
                Rooms & Details
              </th>
              {days.map((d) => {
                const isToday = d.toDateString() === new Date().toDateString();
                return (
                  <th
                    key={d.toISOString()}
                    className={cn(
                      "p-3 text-center font-semibold border-r border-white/5 min-w-[80px]",
                      isToday ? "bg-indigo-500/10 text-indigo-300" : "text-slate-400"
                    )}
                  >
                    <div className="text-[10px] uppercase tracking-wider">
                      {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                    </div>
                    <div className="text-base font-bold mt-0.5">
                      {d.getDate()}
                    </div>
                    <div className="text-[9px] opacity-60">
                      {d.toLocaleDateString('en-IN', { month: 'short' })}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rooms && rooms.length > 0 ? (
              rooms.map((room) => {
                let skipCount = 0;

                return (
                  <tr key={room.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors h-16">
                    {/* Room Info Cell */}
                    <td className="p-4 sticky left-0 bg-slate-950/90 z-10 border-r border-white/10 flex flex-col justify-center h-16">
                      <div className="flex justify-between items-center">
                        <span className="font-black text-slate-200 text-base">Room {room.roomNumber}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase bg-white/5 text-slate-400">
                          {room.category.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {formatCurrency(Number(room.price ?? room.category.basePrice))}/night
                      </span>
                    </td>

                    {/* Timeline Cells */}
                    {days.map((day, idx) => {
                      if (skipCount > 0) {
                        skipCount--;
                        return null; // Skip rendering cell since it's spanned by a booking
                      }

                      const booking = getReservationForNight(room.id, day);

                      if (booking) {
                        // Calculate colSpan: remaining nights in the 14-day window
                        let span = 1;
                        const checkOutDate = new Date(booking.checkOut);
                        checkOutDate.setHours(0, 0, 0, 0);

                        for (let s = idx + 1; s < days.length; s++) {
                          const nextDay = days[s];
                          if (nextDay < checkOutDate) {
                            span++;
                          } else {
                            break;
                          }
                        }

                        skipCount = span - 1;

                        const isToday = day.toDateString() === new Date().toDateString();

                        return (
                          <td
                            key={day.toISOString()}
                            colSpan={span}
                            className={cn("p-1.5 border-r border-white/5 align-middle", isToday && "bg-indigo-500/5")}
                          >
                            <div
                              onClick={() => onManageClick(booking)}
                              className={cn(
                                'h-11 rounded-lg p-2 flex flex-col justify-center cursor-pointer transition-all duration-150 relative overflow-hidden group select-none',
                                STATUS_GRADIENTS[booking.status] || 'bg-slate-800 text-white'
                              )}
                            >
                              <div className="font-semibold text-xs truncate pr-1">
                                {booking.guest.firstName} {booking.guest.lastName}
                              </div>
                              <div className="flex justify-between items-center text-[9px] opacity-80 mt-0.5">
                                <span className="font-mono">{booking.bookingRef}</span>
                                <span>{booking.status}</span>
                              </div>

                              {/* Glowing bottom indicator */}
                              <div className={cn(
                                "absolute bottom-0 left-0 right-0 h-[2px]",
                                booking.status === 'CONFIRMED' ? 'bg-amber-500' :
                                booking.status === 'CHECKED_IN' ? 'bg-emerald-500' :
                                booking.status === 'CHECKED_OUT' ? 'bg-blue-500' : 'bg-slate-500'
                              )} />
                            </div>
                          </td>
                        );
                      }

                      // Empty Cell
                      const isToday = day.toDateString() === new Date().toDateString();
                      const dateStr = day.toISOString().split('T')[0];

                      return (
                        <td
                          key={day.toISOString()}
                          className={cn(
                            "p-1.5 text-center border-r border-white/5 group/cell relative cursor-pointer hover:bg-indigo-500/5 transition-colors h-16 align-middle",
                            isToday ? "bg-indigo-500/5" : ""
                          )}
                          onClick={() => onCheckInClick(room.id, dateStr)}
                        >
                          <div className="opacity-0 group-hover/cell:opacity-100 flex items-center justify-center transition-all duration-150">
                            <Plus className="h-4 w-4 text-indigo-400 bg-indigo-500/10 p-0.5 rounded-full border border-indigo-500/20" />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={15} className="p-12 text-center text-muted-foreground">
                  No rooms added to this branch yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
