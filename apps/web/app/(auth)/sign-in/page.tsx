import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { safeNextPath } from '@/lib/redirect';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-in" next={safeNextPath(typeof next === 'string' ? next : null)} />;
}
