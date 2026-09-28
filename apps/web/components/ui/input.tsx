import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-full border border-line bg-surface px-4 text-sm text-fg outline-none transition-colors placeholder:text-faint hover:border-faint focus-visible:border-accent focus-visible:outline-none aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor
  return <label className={cn('font-medium text-muted text-sm', className)} {...props} />;
}
