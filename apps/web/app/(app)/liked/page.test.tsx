import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

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

test('play stops when a page fails to load, and says so', async () => {
  const { requests } = stubApi({
    'GET /api/me/likes': ({ query }) =>
      query.get('cursor')
        ? apiError(500, 'INTERNAL', 'Something went wrong')
        : Response.json(page(1, 'c1')),
    'GET /api/me/likes/ids': ['audius:t1', 'audius:t2'],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  const play = await screen.findByRole('button', { name: 'Play Liked Songs' });
  await userEvent.click(play);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('Couldn’t load Liked Songs. Something went wrong'),
  );
  // No retry loop: once the failure is reported, no more pages are requested.
  const settled = requests.length;
  await new Promise((done) => setTimeout(done, 300));
  expect(requests).toHaveLength(settled);
  expect(player.store.getState().queue.current).toBeNull();
  expect(play).toBeEnabled();
});

test('something else started while the list loads keeps playing', async () => {
  let release: () => void = () => {};
  stubApi({
    'GET /api/me/likes': ({ query }) =>
      query.get('cursor')
        ? new Promise<Response>((done) => {
            release = () => done(Response.json(page(2, null)));
          })
        : Response.json(page(1, 'c1')),
    'GET /api/me/likes/ids': ['audius:t1', 'audius:t2'],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  await userEvent.click(await screen.findByRole('button', { name: 'Play Liked Songs' }));
  act(() => player.actions.playContext([track(9)], 0, { type: 'search', name: 'Search' }));
  act(() => release());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Play Liked Songs' })).toBeEnabled(),
  );
  expect(player.store.getState().queue.current?.track.id).toBe('audius:t9');
  expect(player.store.getState().queue.context?.type).toBe('search');
});
