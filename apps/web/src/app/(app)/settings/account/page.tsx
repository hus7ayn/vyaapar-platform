'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
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
    <div className="p-6 max-w-lg mx-auto">
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
