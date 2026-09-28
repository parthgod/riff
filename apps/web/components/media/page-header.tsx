'use client';

import type { ReactNode } from 'react';
import { backdrop } from '@/components/player/now-playing';
import { Skeleton } from '@/components/ui/skeleton';
import { useDominantColor } from '@/lib/use-dominant-color';

interface PageHeaderProps {
  /** Small label above the title, e.g. "Playlist" or "Album". */
  kind: ReactNode;
  title: ReactNode;
  cover: ReactNode;
  /** Artwork to tint the header with. */
  tintFrom?: string;
  meta?: ReactNode;
  children?: ReactNode;
}

/** The header of a list page: cover, kind, title, details, then its actions. */
export function PageHeader({ kind, title, cover, tintFrom, meta, children }: PageHeaderProps) {
  const color = useDominantColor(tintFrom);
  return (
    <div style={backdrop(color)} className="-mt-16 pt-16">
      <header className="flex flex-col gap-5 px-4 pt-4 pb-6 md:flex-row md:items-end md:px-8 md:pt-8">
        <div className="w-40 shrink-0 self-center shadow-2xl shadow-black/50 md:w-52 md:self-auto">
          {cover}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-medium text-muted text-sm">{kind}</p>
          <h1 className="break-words font-bold text-3xl tracking-tight md:text-5xl">{title}</h1>
          {meta && <div className="text-muted text-sm">{meta}</div>}
        </div>
      </header>
      {children && <div className="flex items-center gap-2 px-4 pb-4 md:px-8">{children}</div>}
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col gap-5 px-4 pt-4 pb-6 md:flex-row md:items-end md:px-8 md:pt-8"
    >
      <Skeleton className="size-40 self-center md:size-52 md:self-auto" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-40" />
      </div>
    </div>
  );
}
