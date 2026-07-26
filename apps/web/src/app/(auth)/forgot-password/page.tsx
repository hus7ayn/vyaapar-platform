'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '@nexus/shared';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(false);

  // No email verification: identity is verified by the account's email + the role-specific
  // reset key (Super Admin / Admin / Biller key) issued to your organisation.
  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStrongPassword(password)) {
      setPasswordError(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setPasswordError('');
    setLoading(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, roleKey, newPassword: password }),
      });
      toast.success('Password reset! You can sign in now.');
      window.location.href = '/login';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid reset key or email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={reset} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Account email</label>
              <Input type="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Reset key</label>
              <Input placeholder="Super Admin / Admin / Biller key" required value={roleKey} onChange={(e) => setRoleKey(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">Enter the reset key for your role, provided by your organisation.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">New password</label>
              <PasswordInput placeholder="New password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              {passwordError ? (
                <p className="text-xs text-destructive">{passwordError}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">{PASSWORD_POLICY_MESSAGE}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>Reset password</Button>
          </form>
          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="text-primary hover:underline">Back to login</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
