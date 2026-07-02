'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { usePosStore } from '@/stores/pos-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Party {
  id: string;
  name: string;
  phone?: string | null;
  loyaltyPoints?: number;
}

export function CustomerPicker() {
  const token = useAuthStore((s) => s.accessToken)!;
  const customerId = usePosStore((s) => s.customerId);
  const setCustomer = usePosStore((s) => s.setCustomer);
  const pointsRedeemed = usePosStore((s) => s.pointsRedeemed);
  const setPointsRedeemed = usePosStore((s) => s.setPointsRedeemed);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newGstin, setNewGstin] = useState('');

  const qc = useQueryClient();

  const { data: searchResults, refetch: refetchSearch } = useQuery({
    queryKey: ['parties-search', search],
    queryFn: () =>
      api<Party[]>(
        `/parties?type=CUSTOMER&search=${encodeURIComponent(search)}`,
        { token },
      ),
    enabled: open,
  });

  const { data: selectedCustomer } = useQuery({
    queryKey: ['party', customerId],
    queryFn: () => api<Party>(`/parties/${customerId}`, { token }),
    enabled: !!customerId,
  });

  const createPartyMutation = useMutation({
    mutationFn: () =>
      api<Party>('/parties', {
        method: 'POST',
        body: JSON.stringify({
          name: newName,
          phone: newPhone || undefined,
          email: newEmail || undefined,
          gstin: newGstin || undefined,
          partyType: 'CUSTOMER',
        }),
        token,
      }),
    onSuccess: (newCust) => {
      toast.success('Customer registered');
      setCustomer(newCust.id);
      qc.invalidateQueries({ queryKey: ['parties'] });
      refetchSearch();
      setShowAddModal(false);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setNewGstin('');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create customer'),
  });

  const loyalty = selectedCustomer?.loyaltyPoints ?? 0;

  return (
    <div className="relative flex flex-col items-start gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)} className="gap-2">
        <User className="h-4 w-4" />
        {selectedCustomer ? selectedCustomer.name : 'Customer'}
      </Button>

      {selectedCustomer && loyalty > 0 && (
        <div className="flex items-center gap-2 text-sm bg-accent/50 p-2 rounded-lg w-full">
          <span className="flex-1">
            <span className="font-bold text-primary">{loyalty}</span> points available
          </span>
          {pointsRedeemed > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setPointsRedeemed(0)} className="h-7 text-destructive">
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setPointsRedeemed(loyalty)} className="h-7">
              Redeem (₹{loyalty})
            </Button>
          )}
        </div>
      )}

      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-card border rounded-xl shadow-xl z-20 p-3">
          <Input
            placeholder="Search customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2"
          />
          <button
            type="button"
            className="w-full text-center px-3 py-1.5 rounded-lg border border-dashed border-primary/40 text-primary text-xs font-bold hover:bg-primary/5 mb-2 flex items-center justify-center gap-1"
            onClick={() => { setShowAddModal(true); setOpen(false); }}
          >
            <Plus className="h-3.5 w-3.5" /> Register New Customer
          </button>
          <div className="max-h-48 overflow-y-auto space-y-1">
            <button
              type="button"
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-sm"
              onClick={() => { setCustomer(undefined); setOpen(false); }}
            >
              Walk-in customer
            </button>
            {(searchResults ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-sm"
                onClick={() => { setCustomer(c.id); setOpen(false); }}
              >
                <p className="font-medium">{c.name}</p>
                {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register New Customer</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return toast.error('Name required');
              createPartyMutation.mutate();
            }}
            className="space-y-3"
          >
            <Input placeholder="Name *" value={newName} onChange={(e) => setNewName(e.target.value)} required />
            <Input placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            <Input placeholder="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <Input placeholder="GSTIN" value={newGstin} onChange={(e) => setNewGstin(e.target.value)} className="uppercase" />
            <Button type="submit" className="w-full" disabled={createPartyMutation.isPending}>Save & Select</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
