import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { QueuePanel, queueDropIndex } from './queue-panel';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Night drive' };

beforeEach(() => {
  player.actions.reset();
});

function setup() {
  act(() => {
    player.actions.playContext(tracks(3), 0, ctx);
    player.actions.addToQueue([track(8), track(9)]);
  });
  render(<QueuePanel />);
}

const titlesIn = (heading: string) => {
  const section = screen.getByRole('heading', { name: heading }).parentElement?.nextElementSibling;
  return within(section as HTMLElement)
    .getAllByRole('listitem')
    .map((row) => row.textContent);
};

describe('QueuePanel', () => {
  test('shows what is playing, the queue and the rest of the context', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Track 1, now playing' })).toBeDisabled();
    expect(titlesIn('Next in queue')).toEqual(['Track 8Artist 8', 'Track 9Artist 9']);
    expect(titlesIn('Next from Night drive')).toEqual(['Track 2Artist 2', 'Track 3Artist 3']);
  });

  test('clicking an upcoming track plays it', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play Track 3' }));
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t3');
  });

  test('removes one item, or clears the whole queue', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Track 8 from the queue' }));
    expect(titlesIn('Next in queue')).toEqual(['Track 9Artist 9']);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('heading', { name: 'Next in queue' })).not.toBeInTheDocument();
  });

  test('empty queue explains how to fill it', () => {
    render(<QueuePanel />);
    expect(screen.getByText(/Your queue is empty/)).toBeInTheDocument();
  });

  test('queueDropIndex maps a drop target to its position', () => {
    const upNext = [
      { uid: 'a', track: track(1) },
      { uid: 'b', track: track(2) },
    ];
    expect(queueDropIndex(upNext, 'b')).toBe(1);
    expect(queueDropIndex(upNext, 'zz')).toBeNull();
    expect(queueDropIndex(upNext, null)).toBeNull();
  });
});
