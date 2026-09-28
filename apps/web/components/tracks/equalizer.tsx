import { cn } from '@/lib/cn';

/** Animated bars marking the playing track; still when paused or with reduced motion. */
export function Equalizer({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('flex h-3.5 items-end gap-[2px]', className)}>
      {[0, 180, 90].map((delay) => (
        <span
          key={delay}
          className={cn(
            'h-full w-[3px] origin-bottom rounded-full bg-accent',
            playing ? 'motion-safe:animate-eq' : 'scale-y-50',
          )}
          style={{ animationDelay: `-${delay}ms` }}
        />
      ))}
    </span>
  );
}
