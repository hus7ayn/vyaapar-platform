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

/**
 * Two steps: ask for a code, then spend it. Only a Super Admin can recover this way — staff are
 * reset by their Super Admin from the Users screen. The server's reply to step one is deliberately
 * identical whatever address is typed, so this screen can't be used to find out who is who.
 */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<'request' | 'code'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setNotice(res.message);
      setStep('code');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send a code right now');
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
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
        body: JSON.stringify({ email, code, newPassword: password }),
      });
      toast.success('Password changed. Sign in with your new one.');
      window.location.href = '/login';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{step === 'request' ? 'Forgot your password?' : 'Check your email'}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'request' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Type the email address on your account and we&apos;ll send you a six-digit code.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Account email</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send me a code'}
              </Button>
              <p className="rounded-lg border bg-muted/40 p-3 text-[11px] text-muted-foreground">
                <strong className="text-foreground">Working the counter?</strong> Only the shop&apos;s
                Super Admin can reset their own password by email. Ask them to set a new one for you
                from the Users screen — it takes seconds and works even with the internet down.
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              {notice && (
                <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                  {notice}
                </p>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Six-digit code</label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  required
                  autoFocus
                  className="text-center text-2xl font-bold tracking-[0.4em] font-mono h-14"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">New password</label>
                <PasswordInput
                  placeholder="New password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {passwordError ? (
                  <p className="text-xs text-destructive">{passwordError}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">{PASSWORD_POLICY_MESSAGE}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
                {loading ? 'Setting…' : 'Set new password'}
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setStep('request'); setCode(''); setNotice(''); }}
              >
                Didn&apos;t get it? Check spam, or use a different address
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="text-primary hover:underline">Back to login</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
