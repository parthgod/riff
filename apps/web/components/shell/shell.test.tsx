import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { STORAGE_KEY } from '@/lib/player/persistence';
import { noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { PlayerShortcuts } from './player-shortcuts';
import { Sidebar } from './sidebar';
import { UserMenu } from './user-menu';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, pathname: '/' }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth-client', () => ({ authClient: auth }));

const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const playlist = {
  id: PID,
  name: 'Gym',
  description: null,
  coverUrl: null,
  isPublic: false,
  trackCount: 3,
  covers: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
const artist = { id: 'audius:a1', source: 'audius', name: 'Kaito', avatar: {}, verified: false };

let requests: ReturnType<typeof stubApi>['requests'];

beforeEach(() => {
  player.actions.reset();
  ({ requests } = stubApi({
    'GET /api/me/likes/ids': ['audius:t1', 'audius:t2'],
    'GET /api/me/playlists': [playlist],
    'GET /api/me/following': [artist],
    'POST /api/me/playlists': () =>
      Response.json({ ...playlist, id: 'new-id', name: 'Focus' }, { status: 201 }),
    'GET /api/me': {
      id: 'u1',
      name: 'Ada Byron',
      email: 'ada@example.com',
      image: null,
      createdAt: '',
    },
    'PUT /api/me/likes/audius:t9': noContent,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Sidebar', () => {
  test('lists Liked Songs, playlists and followed artists', async () => {
    const { wrapper } = queryWrapper();
    render(<Sidebar />, { wrapper });
    expect(await screen.findAllByRole('link', { name: /Gym/ })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: /Kaito/ })[0]).toHaveAttribute(
      'href',
      '/artist/audius:a1',
    );
    expect(await screen.findAllByText('Playlist · 2 songs')).not.toHaveLength(0);
  });

  test('creates a playlist and opens it', async () => {
    const { wrapper } = queryWrapper();
    render(<Sidebar />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'New playlist' }));
    await userEvent.type(await screen.findByLabelText('Name'), 'Focus');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith('/playlist/new-id'));
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ name: 'Focus' });
  });
});

describe('UserMenu', () => {
  test('signing out stops playback and forgets the saved queue', async () => {
    localStorage.setItem(STORAGE_KEY, '{}');
    act(() => player.actions.playContext([track(1)], 0, { type: 'search', name: 'Search' }));
    const { wrapper } = queryWrapper();
    render(<UserMenu />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Account: Ada Byron' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/sign-in'));
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(player.store.getState().queue.current).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('PlayerShortcuts', () => {
  test('L likes the playing track', async () => {
    act(() => player.actions.playContext([track(9)], 0, { type: 'search', name: 'Search' }));
    const { wrapper } = queryWrapper();
    render(<PlayerShortcuts />, { wrapper });
    fireEvent.keyDown(window, { key: 'l' });
    await waitFor(() =>
      expect(requests.some((r) => r.method === 'PUT' && r.path === '/api/me/likes/audius:t9')).toBe(
        true,
      ),
    );
  });

  test('/ focuses the search box, or opens search when there is none', () => {
    const { wrapper } = queryWrapper();
    const { rerender } = render(<PlayerShortcuts />, { wrapper });
    fireEvent.keyDown(window, { key: '/' });
    expect(nav.router.push).toHaveBeenCalledWith('/search');
    rerender(
      <>
        <PlayerShortcuts />
        <input data-search-input aria-label="Search" />
      </>,
    );
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
  });
});
