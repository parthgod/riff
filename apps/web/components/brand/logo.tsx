import { cn } from '@/lib/cn';

/** Wordmark: three equalizer bars and the name. `labelClassName` can hide the name. */
export function Logo({
  className,
  labelClassName,
}: {
  className?: string;
  labelClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span aria-hidden className="flex h-[0.9em] items-end gap-[0.12em]">
        <span className="h-[55%] w-[0.18em] rounded-full bg-accent" />
        <span className="h-full w-[0.18em] rounded-full bg-accent" />
        <span className="h-[75%] w-[0.18em] rounded-full bg-accent" />
      </span>
      <span className={labelClassName}>Riff</span>
    </span>
  );
}
