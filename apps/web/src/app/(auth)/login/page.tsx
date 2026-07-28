'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { APP_NAME, SystemRole } from '@nexus/shared';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError('');
    try {
      const res = await api<{
        accessToken: string;
        refreshToken: string;
        user: {
          id: string;
          email: string;
          businessId: string;
          branchId?: string;
          role: string;
          permissions: string[];
        };
      }>('/auth/login', { method: 'POST', body: JSON.stringify(data) });
      setAuth(res);
      const landing = res.user.role === SystemRole.SUPER_ADMIN ? '/platform' : res.user.role === 'BILLER' ? '/pos' : '/dashboard';
      router.push(landing);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-[hsl(348,85%,52%)] flex-col justify-center items-center p-12 text-white">
        <div className="max-w-md space-y-6">
          <div className="h-16 w-16 rounded-2xl bg-white flex items-center justify-center text-[hsl(348,85%,52%)] font-extrabold text-3xl shadow-lg">
            M
          </div>
          <h1 className="text-4xl font-extrabold leading-tight">{APP_NAME}</h1>
          <p className="text-lg text-white/90 leading-relaxed">
            Billing, accounting & inventory — all in one simple app for your business.
          </p>
          <ul className="space-y-3 text-white/80 text-sm">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              GST-compliant invoicing & billing
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              Inventory & stock management
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              Party ledger, expenses & reports
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              Works offline — syncs when online
            </li>
          </ul>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-[hsl(0,0%,98%)]">
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden text-center space-y-2">
            <div className="mx-auto h-14 w-14 rounded-xl bg-[hsl(348,85%,52%)] flex items-center justify-center text-white font-extrabold text-2xl shadow">
              M
            </div>
            <h2 className="text-2xl font-bold">{APP_NAME}</h2>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold hidden lg:block">Sign in</h2>
            <p className="text-sm text-muted-foreground">Enter your business account credentials</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="name@company.com"
                className="h-11 bg-white"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Password</label>
              <PasswordInput
                placeholder="••••••••"
                className="h-11 bg-white"
                {...register('password')}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)] text-white font-semibold"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="space-y-2 text-center text-sm text-muted-foreground">
            <p>
              <Link href="/forgot-password" className="text-[hsl(348,85%,52%)] hover:underline font-medium">
                Forgot password?
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
