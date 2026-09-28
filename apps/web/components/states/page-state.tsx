'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/query-client';

/** A page-level failure: Retry for upstream and network errors, a way home for missing pages. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const missing = error instanceof ApiRequestError && error.status === 404;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <p className="font-semibold text-lg">{missing ? 'Not found' : 'Couldn’t load this'}</p>
      <p className="max-w-sm text-muted text-sm">{describeError(error)}</p>
      {missing ? (
        <Button asChild className="mt-2">
          <Link href="/">Go home</Link>
        </Button>
      ) : (
        <Button className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <Icon className="size-10 text-faint" aria-hidden />
      <p className="font-semibold text-lg">{title}</p>
      {children && <p className="max-w-sm text-muted text-sm">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
