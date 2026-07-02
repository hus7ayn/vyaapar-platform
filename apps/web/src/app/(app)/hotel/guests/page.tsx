'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserCircle, Phone, CalendarDays, Building } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function GuestRegistryContent() {
  const token = useAuthStore((s) => s.accessToken)!;
  const searchParams = useSearchParams();
  const initialBranchId = searchParams.get('branchId') || '';

  const [search, setSearch] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(initialBranchId);

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

  // Fetch guests strictly for the selected branch
  const { data: guests, isLoading } = useQuery({
    queryKey: ['hotel-guests', search, selectedBranchId],
    queryFn: () =>
      api<any[]>(`/hotel/guests?search=${encodeURIComponent(search)}&branchId=${selectedBranchId}`, { token }),
    enabled: !!selectedBranchId,
  });

  const guestsArray = Array.isArray(guests) ? guests : (guests as any)?.data || [];

  const groupedGuests = guestsArray.reduce((acc: any, guest: any) => {
    const date = new Date(guest.createdAt).toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(guest);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header & Branch Switcher */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-4 rounded-xl border border-white/5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCircle className="h-6 w-6 text-primary" /> Guest Registry
          </h1>
          <p className="text-xs text-muted-foreground">Database of hotel guests and uploaded ID documents for the selected branch.</p>
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

          <Link href={`/hotel?branchId=${selectedBranchId}`}>
            <Button variant="outline">Back to PMS</Button>
          </Link>
        </div>
      </div>

      <div className="relative w-full md:w-96">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading guests...</div>
      ) : guestsArray.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
          No guests found matching your search.
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedGuests || {}).map(([dateLabel, dailyGuests]) => (
            <div key={dateLabel}>
              <h2 className="text-xl font-semibold mb-4 border-b pb-2">{dateLabel}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(dailyGuests as any[]).map((guest: any) => {
                  const totalSpent = guest.reservations?.reduce((sum: number, r: any) => sum + Number(r.totalAmount || 0), 0) || 0;
                  const pastVisits = guest.reservations?.length || 0;

                  return (
                    <Card key={guest.id} className="overflow-hidden hover:shadow-md transition-shadow">
                      <CardContent className="p-0">
                        <div className="p-4 border-b bg-muted/20 flex justify-between items-start">
                          <div>
                            <h3 className="font-bold text-lg">{guest.firstName} {guest.lastName}</h3>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                              <Phone className="h-3 w-3" />
                              {guest.phone || 'No phone'}
                            </div>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                              <CalendarDays className="h-3 w-3" />
                              Added: {new Date(guest.createdAt).toLocaleTimeString()}
                            </div>
                          </div>
                          {guest.documentPublicUrl ? (
                            <div className="text-right">
                              <span className="inline-block px-2 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full mb-2">
                                {guest.idProofType || 'ID Document'}
                              </span>
                              <br />
                              <a 
                                href={guest.documentPublicUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                View Document &rarr;
                              </a>
                            </div>
                          ) : (
                            <span className="inline-block px-2 py-1 bg-gray-100 text-gray-500 text-xs font-semibold rounded-full">
                              No ID uploaded
                            </span>
                          )}
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-4 text-sm bg-card">
                          <div>
                            <p className="text-muted-foreground mb-1">Total Visits</p>
                            <p className="font-semibold">{pastVisits} {pastVisits === 1 ? 'stay' : 'stays'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground mb-1">Total Spent</p>
                            <p className="font-semibold text-primary">{formatCurrency(totalSpent)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuestRegistryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-muted-foreground">Loading guest registry...</div>}>
      <GuestRegistryContent />
    </Suspense>
  );
}
