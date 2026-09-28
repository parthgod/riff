import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { safeNextPath } from '@/lib/redirect';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-up" next={safeNextPath(typeof next === 'string' ? next : null)} />;
}
