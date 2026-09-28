'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

type Mode = 'sign-in' | 'sign-up';

interface AuthError {
  code?: string;
  message?: string;
  status?: number;
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'Sign-ups are closed on this server.',
  USER_ALREADY_EXISTS: 'An account with this email already exists.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long.',
};

export function authErrorMessage(error: AuthError): string {
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code] as string;
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return error.message || 'Something went wrong. Try again.';
}

const COPY = {
  'sign-in': {
    title: 'Sign in',
    submit: 'Sign in',
    switchText: 'New here?',
    switchLink: 'Create an account',
    switchHref: '/sign-up',
  },
  'sign-up': {
    title: 'Create your account',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
    switchHref: '/sign-in',
  },
} as const;

export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));
    setPending(true);
    setError(null);
    try {
      const result =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ name: String(form.get('name')), email, password });
      if (result.error) {
        setError(authErrorMessage(result.error));
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
      <h1 className="font-semibold text-2xl tracking-tight">{copy.title}</h1>
      {mode === 'sign-up' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required maxLength={100} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'sign-up' ? 8 : undefined}
        />
        {mode === 'sign-up' && <p className="text-faint text-xs">At least 8 characters.</p>}
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {copy.submit}
      </Button>
      <p className="text-muted text-sm">
        {copy.switchText}{' '}
        <Link
          href={`${copy.switchHref}?next=${encodeURIComponent(next)}`}
          className="font-medium text-fg underline-offset-4 hover:underline"
        >
          {copy.switchLink}
        </Link>
      </p>
    </form>
  );
}
