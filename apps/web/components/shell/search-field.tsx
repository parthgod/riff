'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export const SEARCH_DEBOUNCE_MS = 250;

/**
 * The search box. Typing updates /search?q= (replacing history entries while on the search
 * page, so Back leaves search instead of stepping through keystrokes).
 */
export function SearchField({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const onSearchPage = pathname === '/search';
  const urlQuery = onSearchPage ? (params.get('q') ?? '') : '';
  const [value, setValue] = useState(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Queries this box navigated to whose URL hasn't landed yet. */
  const pending = useRef(new Set<string>());

  // Follow the URL when it changes from elsewhere (Back, a genre link, leaving the page).
  // The URL catching up with this box's own search is not such a change: the listener may
  // have typed more since, and resetting the box would erase it.
  useEffect(() => {
    if (pending.current.delete(urlQuery)) return;
    pending.current.clear();
    setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const navigate = (text: string) => {
    const q = text.trim();
    pending.current.add(q);
    const href = q ? `/search?q=${encodeURIComponent(q)}` : '/search';
    if (onSearchPage) router.replace(href, { scroll: false });
    else router.push(href);
  };

  return (
    <search className={cn('relative block w-full max-w-md', className)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          clearTimeout(timer.current);
          navigate(value);
        }}
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          type="search"
          data-search-input
          aria-label="Search"
          placeholder="Search tracks, artists, radio"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => navigate(next), SEARCH_DEBOUNCE_MS);
          }}
          className="h-11 w-full rounded-full border border-line bg-surface pr-4 pl-10 text-sm outline-none transition-colors placeholder:text-faint hover:border-faint focus-visible:border-accent focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
      </form>
    </search>
  );
}
