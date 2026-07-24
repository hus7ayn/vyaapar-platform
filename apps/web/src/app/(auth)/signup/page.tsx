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
import { APP_NAME, PASSWORD_MIN_LENGTH, PASSWORD_COMPLEXITY_REGEX, PASSWORD_POLICY_MESSAGE } from '@nexus/shared';

const schema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_POLICY_MESSAGE).regex(PASSWORD_COMPLEXITY_REGEX, PASSWORD_POLICY_MESSAGE),
});

type FormData = z.infer<typeof schema>;

const FIELDS = ['businessName', 'firstName', 'lastName', 'email', 'password'] as const;

export default function SignupPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        user: { id: string; email: string; businessId: string; branchId?: string; role: string; permissions: string[] };
      }>('/auth/signup', { method: 'POST', body: JSON.stringify(data) });
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
            M
          </div>
          <h1 className="text-2xl font-bold">Start with {APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">Create your business account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 bg-white rounded-xl border p-6 shadow-sm">
          {FIELDS.map((field) => (
            <div key={field} className="space-y-1">
              {field === 'password' ? (
                <PasswordInput
                  placeholder="Password"
                  className="h-11"
                  {...register(field)}
                />
              ) : (
                <Input
                  placeholder={field.replace(/([A-Z])/g, ' $1')}
                  type={field === 'email' ? 'email' : 'text'}
                  className="h-11"
                  {...register(field)}
                />
              )}
              {field === 'password' && !errors.password && (
                <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_MESSAGE}</p>
              )}
              {errors[field] && <p className="text-xs text-destructive">{errors[field]?.message}</p>}
            </div>
          ))}
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{error}</p>}
          <Button
            type="submit"
            className="w-full h-11 bg-[hsl(348,85%,52%)] hover:bg-[hsl(348,85%,45%)] text-white font-semibold"
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Sign Up'}
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
