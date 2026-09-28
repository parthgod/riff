'use client';

import {
  House,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ui, useUi } from '@/lib/ui-store';
import { CreatePlaylistDialog } from './create-playlist-dialog';
import { LibraryList } from './library-list';

export const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: House },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/radio', label: 'Radio', icon: Radio },
];

export const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

/** Desktop and tablet navigation. Tablets and a collapsed desktop sidebar show icons only. */
export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  // Labels show on desktop (lg) unless collapsed; tablets always get the compact rail.
  const label = cn('hidden truncate', !collapsed && 'lg:inline');
  return (
    <aside
      aria-label="Sidebar"
      className="fixed top-0 bottom-[var(--player-h)] left-0 z-20 hidden w-[var(--sidebar-w)] flex-col gap-2 p-2 md:flex"
    >
      <div className="flex flex-col gap-1 rounded-xl bg-surface p-2">
        <div className="flex h-10 items-center justify-between px-2">
          <Link href="/" aria-label="Riff home" className="rounded-md">
            <Logo className="text-lg" labelClassName={label} />
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('hidden', !collapsed && 'lg:inline-flex')}
            aria-label="Collapse sidebar"
            onClick={ui.toggleSidebar}
          >
            <PanelLeftClose />
          </Button>
        </div>
        {collapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="mx-auto hidden lg:inline-flex"
            aria-label="Expand sidebar"
            onClick={ui.toggleSidebar}
          >
            <PanelLeftOpen />
          </Button>
        )}
        <nav aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {NAV.map(({ href, label: text, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    title={text}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-10 items-center justify-center gap-3 rounded-lg px-3 font-medium text-muted text-sm hover:text-fg',
                      !collapsed && 'lg:justify-start',
                      active && 'text-fg',
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden />
                    <span className={label}>{text}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <section
        aria-labelledby="library-heading"
        className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl bg-surface p-2"
      >
        <div
          className={cn(
            'flex h-10 items-center justify-center gap-2 px-2',
            !collapsed && 'lg:justify-between',
          )}
        >
          <h2 id="library-heading" className={cn(label, 'font-semibold text-sm')}>
            Library
          </h2>
          <CreatePlaylistDialog>
            <Button variant="ghost" size="icon-sm" aria-label="New playlist">
              <Plus />
            </Button>
          </CreatePlaylistDialog>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(!collapsed && 'lg:hidden')}>
            <LibraryList compact />
          </div>
          <div className={cn('hidden', !collapsed && 'lg:block')}>
            <LibraryList />
          </div>
        </div>
      </section>
    </aside>
  );
}
