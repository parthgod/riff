import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiError, stubApi } from '@/test/api-stub';
import { station, track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { LyricsPanel } from './lyrics-panel';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Mix' };
const synced = {
  synced: [
    { timeMs: 0, text: 'First line' },
    { timeMs: 10_000, text: 'Second line' },
    { timeMs: 20_000, text: 'Third line' },
    { timeMs: 30_000, text: 'Fourth line' },
  ],
  plain: null,
  instrumental: false,
};

let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  player.actions.reset();
  scrollTo = vi.fn();
  Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo'];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPanel(lyrics: unknown) {
  stubApi({
    'GET /api/tracks/audius:t1/lyrics': () =>
      lyrics instanceof Response ? lyrics : Response.json(lyrics),
  });
  act(() => player.actions.playContext([track(1)], 0, ctx));
  const { wrapper } = queryWrapper();
  return render(<LyricsPanel />, { wrapper });
}

const at = (seconds: number) => act(() => player.store.setState({ position: seconds }));

describe('LyricsPanel', () => {
  test('highlights the line being sung and seeks when a line is clicked', async () => {
    renderPanel(synced);
    at(12);
    expect(await screen.findByRole('button', { name: 'Second line' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fourth line' }));
    expect(player.store.getState().position).toBe(30);
  });

  test('pauses auto-scroll for 3 s after the listener scrolls', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    renderPanel(synced);
    await screen.findByRole('list', { name: 'Lyrics' });
    // Opening the panel centres the current line; count only what follows.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();
    at(10);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent.wheel(screen.getByRole('list', { name: 'Lyrics' }));
    at(20);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    now.mockReturnValue(103_001);
    at(30);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  test('says so when there are no lyrics', async () => {
    renderPanel(apiError(404, 'NOT_FOUND', 'No lyrics for this track'));
    expect(await screen.findByText('No lyrics for this track.')).toBeInTheDocument();
  });

  test('shows plain lyrics when there are no timings', async () => {
    renderPanel({ synced: null, plain: 'Line one\nLine two', instrumental: false });
    expect(await screen.findByText(/Line one/)).toBeInTheDocument();
  });

  test('offers a retry when loading fails', async () => {
    renderPanel(apiError(504, 'UPSTREAM_TIMEOUT'));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  test('explains that live radio has no lyrics, without asking the API', () => {
    const { requests } = stubApi({});
    act(() => player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' }));
    const { wrapper } = queryWrapper();
    render(<LyricsPanel />, { wrapper });
    expect(screen.getByText('Lyrics aren’t available for live radio.')).toBeInTheDocument();
    expect(requests).toEqual([]);
  });
});
