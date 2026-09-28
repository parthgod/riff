'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { SearchField } from './search-field';
import { UserMenu } from './user-menu';

export function TopBar() {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-2 bg-bg/85 px-4 backdrop-blur-md md:px-6">
      <Link href="/" aria-label="Riff home" className="rounded-md md:hidden">
        <Logo className="text-lg" />
      </Link>
      <div className="hidden items-center gap-1 md:flex">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.back()}>
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          onClick={() => router.forward()}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="hidden flex-1 md:block">
        <Suspense>
          <SearchField />
        </Suspense>
      </div>
      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  );
}
