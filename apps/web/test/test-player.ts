import type { StreamInfo } from '@riff/core';
import { vi } from 'vitest';
import { AudioEngine } from '@/lib/player/engine';
import { createPlayer } from '@/lib/player/player';
import { FakeMedia } from '@/test/fake-media';

/** A real player over a fake media element, for tests of the browser integrations. */
export function createTestPlayer() {
  const media = new FakeMedia();
  const resolve = vi.fn(
    async (id: string): Promise<StreamInfo> => ({
      url: `https://a.test/${id}`,
      mirrors: [],
      live: false,
    }),
  );
  let uid = 0;
  const player = createPlayer({
    createEngine: (events) => new AudioEngine(media, resolve, events),
    env: { rng: () => 0.5, uid: () => `u${++uid}` },
    recordPlay: vi.fn(async () => {}),
    notify: vi.fn(),
  });
  return { player, media, resolve };
}
