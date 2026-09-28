import Link from 'next/link';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** A titled row of cards that scrolls sideways (snapping) on narrow screens. */
export function Shelf({
  title,
  href,
  children,
}: {
  title: string;
  /** "Show all" destination. */
  href?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4 px-4 md:px-8">
        <h2 className="font-semibold text-xl tracking-tight">{title}</h2>
        {href && (
          <Link
            href={href}
            className="shrink-0 font-medium text-muted text-sm hover:text-fg hover:underline"
          >
            Show all
          </Link>
        )}
      </div>
      <ul className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:scroll-px-8 md:gap-4 md:px-8 [&::-webkit-scrollbar]:hidden">
        {children}
      </ul>
    </section>
  );
}

export function ShelfSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="mx-4 h-6 w-48 md:mx-8" />
      <div className="flex gap-4 overflow-hidden px-4 md:px-8">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex w-36 shrink-0 flex-col gap-2 md:w-44">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
