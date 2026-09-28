'use client';

import { House, Library, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { isActive } from './sidebar';

const TABS = [
  { href: '/', label: 'Home', icon: House },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/library', label: 'Library', icon: Library },
];

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(var(--tabbar-h)+var(--safe-b))] grid-cols-3 border-line border-t bg-surface/95 pb-[var(--safe-b)] backdrop-blur-md md:hidden"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center justify-center gap-1 font-medium text-[11px] text-muted',
              active && 'text-fg',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
