'use client';

import { useRouter } from 'next/navigation';
import { player } from '@/lib/player/instance';
import { SEEK_STEP_SEC, useShortcuts } from '@/lib/player/shortcuts';
import { useLikedIds, useToggleLike } from '@/lib/queries/library';

/** The first search box actually on screen (the phone and desktop layouts each have one). */
function visibleSearchInput(): HTMLInputElement | null {
  const inputs = document.querySelectorAll<HTMLInputElement>('[data-search-input]');
  return [...inputs].find((input) => input.checkVisibility?.() ?? true) ?? null;
}

/** Binds the keyboard shortcuts (see lib/player/shortcuts.ts) for the whole app. */
export function PlayerShortcuts() {
  const router = useRouter();
  const liked = useLikedIds();
  const toggleLike = useToggleLike();
  const { actions, store } = player;
  useShortcuts({
    togglePlay: () => actions.togglePlay(),
    seekBack: () => actions.seek(store.getState().position - SEEK_STEP_SEC),
    seekForward: () => actions.seek(store.getState().position + SEEK_STEP_SEC),
    prev: () => actions.prev(),
    next: () => actions.next(),
    toggleMute: () => actions.toggleMute(),
    like: () => {
      const track = store.getState().queue.current?.track;
      if (track && !track.isLive) toggleLike.mutate({ track, like: !liked.has(track.id) });
    },
    focusSearch: () => {
      const input = visibleSearchInput();
      if (input) input.focus();
      else router.push('/search');
    },
  });
  return null;
}
