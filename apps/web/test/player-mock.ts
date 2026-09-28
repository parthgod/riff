/**
 * Stand-in for `@/lib/player/instance` in component tests:
 *   vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
 * The player is real; only the media element and the network are fake.
 */
import { useStore } from 'zustand';
import type { PlayerState } from '@/lib/player/player';
import { createTestPlayer } from './test-player';

const testPlayer = createTestPlayer();

export const player = testPlayer.player;
export const media = testPlayer.media;

export function usePlayer<T>(selector: (state: PlayerState) => T): T {
  return useStore(player.store, selector);
}
