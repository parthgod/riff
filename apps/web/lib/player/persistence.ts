import { QueueStateSchema } from '@riff/core';
import { z } from 'zod';
import type { Player, PlayerState, SavedPlayer } from './player';

export const STORAGE_KEY = 'riff:player:v1';
export const SAVE_INTERVAL_MS = 5_000;

const SavedPlayerSchema = z.object({
  queue: QueueStateSchema,
  position: z.number().nonnegative(),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
});

/** The saved player, or null when there is none or it is unreadable (then it is removed). */
export function loadSavedPlayer(storage: Storage): SavedPlayer | null {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const result = SavedPlayerSchema.safeParse(parsed);
  if (result.success) return result.data;
  clearSavedPlayer(storage);
  return null;
}

export function clearSavedPlayer(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

const snapshot = ({ queue, position, volume, muted }: PlayerState): SavedPlayer => ({
  queue,
  position,
  volume,
  muted,
});

const sameSnapshot = (a: SavedPlayer, b: SavedPlayer) =>
  a.queue === b.queue && a.position === b.position && a.volume === b.volume && a.muted === b.muted;

/**
 * Restores the saved player (paused), then saves it every 5 s when it changed and on `pagehide`.
 * Returns a function that stops saving.
 */
export function persistPlayer(player: Player, storage: Storage, target: EventTarget): () => void {
  const saved = loadSavedPlayer(storage);
  if (saved) player.actions.restore(saved);
  let last = snapshot(player.store.getState());

  const write = () => {
    const next = snapshot(player.store.getState());
    if (sameSnapshot(next, last)) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
      last = next;
    } catch {
      // Full or disabled storage: the queue just won't survive a reload.
    }
  };

  const timer = setInterval(write, SAVE_INTERVAL_MS);
  target.addEventListener('pagehide', write);
  return () => {
    clearInterval(timer);
    target.removeEventListener('pagehide', write);
  };
}
