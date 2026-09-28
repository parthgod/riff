'use client';

import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { player, usePlayer } from '@/lib/player/instance';

const REPEAT_LABELS = {
  off: 'Repeat all',
  all: 'Repeat one',
  one: 'Turn repeat off',
} as const;

export function PlayButton({ className, large = false }: { className?: string; large?: boolean }) {
  const { status, hasCurrent } = usePlayer(
    useShallow((s) => ({ status: s.status, hasCurrent: s.queue.current !== null })),
  );
  const active = status === 'playing' || status === 'loading';
  return (
    <Button
      variant="primary"
      size="icon"
      className={cn(
        large ? 'size-16 [&_svg]:size-7' : 'size-10',
        'bg-fg hover:bg-fg/90',
        className,
      )}
      aria-label={active ? 'Pause' : 'Play'}
      disabled={!hasCurrent}
      onClick={() => player.actions.togglePlay()}
    >
      {status === 'loading' ? (
        <Loader2 className="motion-safe:animate-spin" />
      ) : active ? (
        <Pause className="fill-current" />
      ) : (
        <Play className="translate-x-px fill-current" />
      )}
    </Button>
  );
}

/** Shuffle, previous, play/pause, next and repeat. */
export function Transport({ large = false }: { large?: boolean }) {
  const { shuffle, repeat, hasCurrent, live } = usePlayer(
    useShallow((s) => ({
      shuffle: s.queue.shuffle,
      repeat: s.queue.repeat,
      hasCurrent: s.queue.current !== null,
      live: s.queue.current?.track.isLive ?? false,
    })),
  );
  const iconSize = large ? 'size-12 [&_svg]:size-6' : undefined;
  return (
    <div className={cn('flex items-center justify-center', large ? 'gap-4' : 'gap-2')}>
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconSize, shuffle && 'text-accent hover:text-accent')}
        aria-label="Shuffle"
        aria-pressed={shuffle}
        onClick={() => player.actions.toggleShuffle()}
      >
        <Shuffle />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={iconSize}
        aria-label="Previous"
        disabled={!hasCurrent || live}
        onClick={() => player.actions.prev()}
      >
        <SkipBack className="fill-current" />
      </Button>
      <PlayButton large={large} />
      <Button
        variant="ghost"
        size="icon"
        className={iconSize}
        aria-label="Next"
        disabled={!hasCurrent}
        onClick={() => player.actions.next()}
      >
        <SkipForward className="fill-current" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconSize, repeat !== 'off' && 'text-accent hover:text-accent')}
        aria-label={REPEAT_LABELS[repeat]}
        aria-pressed={repeat !== 'off'}
        onClick={() => player.actions.cycleRepeat()}
      >
        {repeat === 'one' ? <Repeat1 /> : <Repeat />}
      </Button>
    </div>
  );
}
