'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

function VerifyEmailInner() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  // React runs effects twice in dev StrictMode; the token is single-use, so the second run
  // would always report failure.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState('failed');
      setMessage('That link is missing its confirmation code.');
      return;
    }

    api('/auth/verify-email/confirm', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setState('done'))
      .catch((err: unknown) => {
        setState('failed');
        setMessage(
          err instanceof Error ? err.message : 'That confirmation link is invalid or has expired.',
        );
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center space-y-4">
          {state === 'working' && (
            <>
              <Loader2 className="h-10 w-10 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Confirming your address…</p>
            </>
          )}

          {state === 'done' && (
            <>
              <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
              <h1 className="text-lg font-semibold">Address confirmed</h1>
              <p className="text-sm text-muted-foreground">
                If you ever forget your password, a reset code will reach you here.
              </p>
              <Button asChild className="w-full">
                <Link href="/login">Continue to login</Link>
              </Button>
            </>
          )}

          {state === 'failed' && (
            <>
              <XCircle className="h-12 w-12 mx-auto text-destructive" />
              <h1 className="text-lg font-semibold">Couldn&apos;t confirm that link</h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <p className="text-xs text-muted-foreground">
                Links last 24 hours and work once. Sign in and use Resend on the account screen to
                get a fresh one.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Back to login</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
