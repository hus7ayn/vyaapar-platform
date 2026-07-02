'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { APP_NAME } from '@nexus/shared';

export default function SignupPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    businessName: '',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string; businessId: string; branchId?: string; role: string; permissions: string[] };
      }>('/auth/signup', { method: 'POST', body: JSON.stringify(form) });
      setAuth(res);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[hsl(0,0%,98%)]">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-xl bg-[hsl(348,85%,52%)] flex items-center justify-center text-white font-extrabold text-2xl shadow">
            V
          </div>
          <h1 className="text-2xl font-bold">Start with {APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">Create your business account — free to get started</p>
        </div>

        <form onSubmit={submit} className="space-y-3 bg-white rounded-xl border p-6 shadow-sm">
          {(['businessName', 'firstName', 'lastName', 'email', 'password'] as const).map((field) => (
            <Input
              key={field}
              placeholder={field.replace(/([A-Z])/g, ' $1')}
              type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
              required
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              className="h-11"
            />
          ))}
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{error}</p>}
          <Button
            type="submit"
            className="w-full h-11 bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)] text-white font-semibold"
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Start Free Trial'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-[hsl(348,85%,52%)] hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
