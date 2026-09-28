import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <section className="relative hidden overflow-hidden bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute -bottom-40 -left-40 size-[36rem] rounded-full bg-accent/15 blur-3xl"
        />
        <Logo className="relative text-2xl" />
        <p className="relative max-w-md font-semibold text-4xl leading-tight tracking-tight">
          Independent music and live radio, free and ad-free.
        </p>
      </section>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-10">
          <Logo className="text-xl lg:hidden" />
          {children}
        </div>
      </section>
    </main>
  );
}
