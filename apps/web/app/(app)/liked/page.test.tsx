import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { apiError, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import LikedPage from './page';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const page = (n: number, nextCursor: string | null) => ({
  items: [{ track: track(n), likedAt: '2026-09-01T00:00:00Z' }],
  nextCursor,
});

beforeEach(() => player.actions.reset());
afterEach(() => vi.unstubAllGlobals());

test('lists liked songs with the total count', async () => {
  stubApi({
    'GET /api/me/likes': page(1, null),
    'GET /api/me/likes/ids': ['audius:t1'],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  expect(await screen.findByRole('button', { name: 'Play Track 1' })).toBeInTheDocument();
  expect(await screen.findByText('1 song')).toBeInTheDocument();
});

test('play fetches every page first, so the queue holds all liked songs', async () => {
  stubApi({
    'GET /api/me/likes': ({ query }) =>
      Response.json(
        query.get('cursor') === 'c2'
          ? page(3, null)
          : query.get('cursor')
            ? page(2, 'c2')
            : page(1, 'c1'),
      ),
    'GET /api/me/likes/ids': ['audius:t1', 'audius:t2', 'audius:t3'],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  await userEvent.click(await screen.findByRole('button', { name: 'Play Liked Songs' }));
  await waitFor(() =>
    expect(player.store.getState().queue.order.map((item) => item.track.id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
    ]),
  );
  expect(player.store.getState().queue.context).toEqual({ type: 'liked', name: 'Liked Songs' });
});

test('an empty library points to search', async () => {
  stubApi({ 'GET /api/me/likes': { items: [], nextCursor: null }, 'GET /api/me/likes/ids': [] });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  expect(await screen.findByRole('link', { name: 'Find something to like' })).toHaveAttribute(
    'href',
    '/search',
  );
});

test('a failure offers a retry', async () => {
  stubApi({
    'GET /api/me/likes': () => apiError(500, 'INTERNAL', 'Something went wrong'),
    'GET /api/me/likes/ids': [],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
