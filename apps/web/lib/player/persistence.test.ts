import { type QueueContext, queue as q } from '@riff/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tracks } from '@/test/fixtures';
import { createTestPlayer } from '@/test/test-player';
import { clearSavedPlayer, loadSavedPlayer, persistPlayer, STORAGE_KEY } from './persistence';

const ctx: QueueContext = { type: 'liked', name: 'Liked Songs' };
const env = { rng: () => 0.5, uid: () => crypto.randomUUID() };

const savedState = () => ({
  queue: q.playContext(q.emptyQueue, tracks(3), 2, ctx, env),
  position: 42.5,
  volume: 0.6,
  muted: false,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadSavedPlayer', () => {
  test('reads back what was saved', () => {
    const saved = savedState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    expect(loadSavedPlayer(localStorage)).toEqual(saved);
  });

  test.each([
    ['broken JSON', '{"queue":'],
    ['a different shape', JSON.stringify({ tracks: [] })],
    ['an out-of-range volume', JSON.stringify({ ...savedState(), volume: 7 })],
  ])('drops %s and removes it', (_, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadSavedPlayer(localStorage)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('treats storage that throws as empty', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {},
    } as unknown as Storage;
    expect(loadSavedPlayer(storage)).toBeNull();
  });
});

describe('persistPlayer', () => {
  test('restores the saved queue paused at its position', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState()));
    const { player, resolve } = createTestPlayer();
    const stop = persistPlayer(player, localStorage, window);
    expect(player.store.getState()).toMatchObject({ status: 'paused', position: 42.5 });
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t3');
    expect(resolve).not.toHaveBeenCalled();
    stop();
  });

  test('saves every 5 seconds while something changed, and on pagehide', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { player } = createTestPlayer();
    const stop = persistPlayer(player, localStorage, window);
    player.actions.playContext(tracks(2), 0, ctx);
    vi.advanceTimersByTime(5_000);
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(setItem).toHaveBeenCalledTimes(1);
    player.store.setState({ position: 12 });
    window.dispatchEvent(new Event('pagehide'));
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(loadSavedPlayer(localStorage)?.position).toBe(12);
    stop();
    player.store.setState({ position: 13 });
    vi.advanceTimersByTime(5_000);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  test('a full or disabled storage does not break playback', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { player } = createTestPlayer();
    const stop = persistPlayer(player, localStorage, window);
    player.actions.playContext(tracks(2), 0, ctx);
    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
    stop();
  });

  test('clearSavedPlayer forgets the saved state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState()));
    clearSavedPlayer(localStorage);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
