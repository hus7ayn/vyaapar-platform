'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, MailWarning, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '@nexus/shared';

export default function AccountSettingsPage() {
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  // Only a Super Admin has a recovery address worth confirming — for everyone else `required`
  // comes back false and nothing below renders.
  const { data: verification, refetch: refetchVerification } = useQuery({
    queryKey: ['verify-email-status'],
    queryFn: () =>
      api<{ required: boolean; verified: boolean; email: string }>('/auth/verify-email/status', { token }),
    enabled: !!token,
  });

  const resendVerification = useMutation({
    mutationFn: () => api('/auth/verify-email/resend', { method: 'POST', token }),
    onSuccess: () => {
      toast.success('Confirmation email sent — check your inbox');
      refetchVerification();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const change = useMutation({
    mutationFn: () =>
      api('/auth/change-password', {
        method: 'POST',
        token,
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      }),
    onSuccess: () => {
      toast.success('Password changed successfully');
      setCurrent(''); setNext(''); setConfirm(''); setError('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStrongPassword(next)) { setError(PASSWORD_POLICY_MESSAGE); return; }
    if (next !== confirm) { setError('New passwords do not match'); return; }
    setError('');
    change.mutate();
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-4">
      {verification?.required && !verification.verified && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <MailWarning className="h-5 w-5 shrink-0 text-amber-700" />
          <div className="flex-1 text-sm text-amber-900">
            <p className="font-semibold">Confirm your recovery email</p>
            <p className="text-xs mt-0.5">
              <span className="font-medium">{verification.email}</span> hasn&apos;t been confirmed.
              It&apos;s the only address that can unlock this shop if you forget your password.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
            disabled={resendVerification.isPending}
            onClick={() => resendVerification.mutate()}
          >
            {resendVerification.isPending ? 'Sending…' : 'Resend confirmation'}
          </Button>
        </div>
      )}

      {verification?.required && verification.verified && (
        <p className="flex items-center gap-2 text-xs text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          Recovery email confirmed — reset codes will reach {verification.email}.
        </p>
      )}

      <Card className="p-6 space-y-4">
        <h1 className="text-lg font-semibold flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Change Password</h1>
        <p className="text-sm text-muted-foreground">Update your password. You&apos;ll stay signed in on this device; other devices are signed out.</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Current password</label>
            <PasswordInput required value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">New password</label>
            <PasswordInput required value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Confirm new password</label>
            <PasswordInput required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password" />
          </div>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">{PASSWORD_POLICY_MESSAGE}</p>
          )}
          <Button type="submit" disabled={change.isPending}>Change password</Button>
        </form>
      </Card>
    </div>
  );
}
