'use client';

import { useEffect } from 'react';
import { player } from '@/lib/player/instance';
import { bindMediaSession } from '@/lib/player/media-session';
import { persistPlayer } from '@/lib/player/persistence';

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Restores and saves the player, and connects the OS media controls. Renders nothing. */
export function PlayerRuntime() {
  useEffect(() => {
    const storage = localStorageOrNull();
    const stopSaving = storage ? persistPlayer(player, storage, window) : () => {};
    const stopSession =
      'mediaSession' in navigator
        ? bindMediaSession(player, navigator.mediaSession, (init) => new MediaMetadata(init))
        : () => {};
    return () => {
      stopSaving();
      stopSession();
    };
  }, []);
  return null;
}
