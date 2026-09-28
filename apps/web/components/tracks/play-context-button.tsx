'use client';

import type { QueueContext, Track } from '@riff/core';
import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { player, usePlayer } from '@/lib/player/instance';
import { describeError } from '@/lib/query-client';

export const sameContext = (a: QueueContext | null, b: QueueContext) =>
  a !== null && a.type === b.type && a.id === b.id;

interface PlayContextButtonProps {
  tracks: readonly Track[];
  context: QueueContext;
  /** Loads the full list first (e.g. every page of Liked Songs). */
  loadAll?: () => Promise<readonly Track[]>;
}

/** The big play button of a list page: plays it from the top, or pauses/resumes it. */
export function PlayContextButton({ tracks, context, loadAll }: PlayContextButtonProps) {
  const { isThis, active } = usePlayer(
    useShallow((s) => ({
      isThis: sameContext(s.queue.context, context),
      active: s.status === 'playing' || s.status === 'loading',
    })),
  );
  const [loading, setLoading] = useState(false);
  const pausing = isThis && active;

  async function onClick() {
    if (isThis) {
      player.actions.togglePlay();
      return;
    }
    let list = tracks;
    if (loadAll) {
      const playingBefore = player.store.getState().queue.context;
      setLoading(true);
      try {
        list = await loadAll();
      } catch (error) {
        toast.error(`Couldn’t load ${context.name}. ${describeError(error)}`);
        return;
      } finally {
        setLoading(false);
      }
      // The listener started something else while the list loaded: leave that playing.
      if (player.store.getState().queue.context !== playingBefore) return;
    }
    player.actions.playContext(list, 0, context);
  }

  return (
    <Button
      variant="primary"
      size="icon"
      className="size-14 shadow-accent/20 shadow-lg [&_svg]:size-6"
      aria-label={pausing ? `Pause ${context.name}` : `Play ${context.name}`}
      disabled={tracks.length === 0 || loading}
      onClick={onClick}
    >
      {pausing ? (
        <Pause className="fill-current" />
      ) : (
        <Play className="translate-x-0.5 fill-current" />
      )}
    </Button>
  );
}
