'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-[11px] text-accent tracking-wide',
        className,
      )}
    >
      LIVE
    </span>
  );
}

/**
 * Elapsed time, a draggable bar and the duration. Dragging previews the position and seeks
 * on release; arrow keys move 1 s (10 s with Page Up/Down). Live streams show a badge.
 */
export function SeekBar({ className }: { className?: string }) {
  const { position, duration, live, hasCurrent } = usePlayer(
    useShallow((s) => ({
      position: s.position,
      duration: s.duration,
      live: s.queue.current?.track.isLive ?? false,
      hasCurrent: s.queue.current !== null,
    })),
  );
  const [dragging, setDragging] = useState<number | null>(null);

  if (live) {
    return (
      <div className={cn('flex h-4 w-full items-center justify-center', className)}>
        <LiveBadge />
      </div>
    );
  }

  const max = duration ?? 0;
  const value = dragging ?? Math.min(position, max);
  return (
    <div
      className={cn('flex w-full items-center gap-2 text-faint text-xs tabular-nums', className)}
    >
      <span className="w-10 shrink-0 text-right">{formatDuration(value)}</span>
      <Slider
        label="Seek"
        valueText={`${formatDuration(value)} of ${formatDuration(max)}`}
        value={[value]}
        max={Math.max(max, 1)}
        step={1}
        disabled={!hasCurrent || max === 0}
        onValueChange={([next]) => setDragging(next ?? null)}
        onValueCommit={([next]) => {
          if (next !== undefined) player.actions.seek(next);
          setDragging(null);
        }}
      />
      <span className="w-10 shrink-0">{formatDuration(max)}</span>
    </div>
  );
}
