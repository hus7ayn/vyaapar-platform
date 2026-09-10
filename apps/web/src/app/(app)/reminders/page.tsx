'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { formatCurrency } from '@/lib/utils';
import { VyaparPageHeader } from '@/components/vyapar/page-header';
import { VyaparActionButton } from '@/components/vyapar/action-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const today = () => isoDay(new Date());
const inAWeek = () => isoDay(new Date(Date.now() + 7 * 86400000));

type Reminder = {
  id: string;
  amount: string | number;
  dueDate: string;
  status: string;
  channel?: string;
  party: { id: string; name: string; phone?: string | null };
};

export default function RemindersPage() {
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const branchId = useAuthStore((s) => s.activeShopId) ?? undefined;
  const qc = useQueryClient();
  const apiOpts = { token, branchId };
  const [remindOn, setRemindOn] = useState(inAWeek());

  const { data: reminders, isLoading } = useQuery({
    queryKey: ['payment-reminders', branchId],
    queryFn: () => api<Reminder[]>('/payment-reminders', apiOpts),
    enabled: !!token,
  });

  const generate = useMutation({
    mutationFn: () =>
      api('/payment-reminders/generate', { method: 'POST', ...apiOpts, body: JSON.stringify({ remindOn }) }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['payment-reminders'] });
      const count = Array.isArray(created) ? created.length : 0;
      toast.success(
        count === 0
          ? 'Every party with dues already has a pending reminder'
          : `${count} reminder${count === 1 ? '' : 's'} set for ${new Date(remindOn).toLocaleDateString()}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reschedule = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) =>
      api(`/payment-reminders/${id}`, { method: 'PATCH', ...apiOpts, body: JSON.stringify({ remindOn: date }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-reminders'] });
      toast.success('Reminder date updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendReminder = useMutation({
    mutationFn: (id: string) => api(`/payment-reminders/${id}/send`, { method: 'POST', ...apiOpts }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-reminders'] });
      toast.success('Reminder marked as sent');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = reminders ?? [];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl">
      <VyaparPageHeader
        title="Payment Reminders"
        subtitle="Send reminders to parties with outstanding balance"
        action={
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground block mb-1">Remind on</label>
              <Input
                type="date"
                className="h-9 w-40"
                min={today()}
                value={remindOn}
                onChange={(e) => setRemindOn(e.target.value)}
              />
            </div>
            <VyaparActionButton
              onClick={() => generate.mutate()}
              label="Generate Reminders"
              color="bg-[hsl(25,95%,53%)]"
            />
          </div>
        }
      />

      <div className="bg-white rounded-lg border shadow-sm divide-y">
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No pending reminders. Click Generate to create from outstanding dues.</p>
          </div>
        ) : (
          list.map((r) => (
            <div key={r.id} className="p-4 flex flex-wrap justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{r.party.name}</p>
                <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                  {r.status === 'PENDING' ? (
                    <label className="flex items-center gap-1.5">
                      Remind on
                      <Input
                        type="date"
                        className="h-7 w-36 text-xs"
                        min={today()}
                        value={r.dueDate.slice(0, 10)}
                        disabled={reschedule.isPending}
                        onChange={(e) => e.target.value && reschedule.mutate({ id: r.id, date: e.target.value })}
                      />
                    </label>
                  ) : (
                    <span>Due {new Date(r.dueDate).toLocaleDateString()}</span>
                  )}
                  {r.party.phone ? <span>· {r.party.phone}</span> : null}
                  {r.channel ? <span>· {r.channel}</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  r.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700',
                )}>
                  {r.status}
                </span>
                <p className="font-bold text-orange-600">{formatCurrency(Number(r.amount))}</p>
                {r.status === 'PENDING' && (
                  <Button size="sm" variant="outline" disabled={sendReminder.isPending} onClick={() => sendReminder.mutate(r.id)}>
                    <Send className="h-3.5 w-3.5 mr-1" /> Send
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
