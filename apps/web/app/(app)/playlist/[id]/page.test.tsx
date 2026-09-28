import type { PlaylistDetail } from '@riff/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import PlaylistPage from './page';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' }),
  useRouter: () => nav.router,
}));

function playlist(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  const entries = [
    { id: 'e1', track: track(1), addedAt: '2026-09-01T00:00:00Z' },
    { id: 'e2', track: track(2), addedAt: '2026-09-01T00:00:00Z' },
  ];
  return {
    id: PID,
    name: 'Night drive',
    description: 'For the long way home',
    coverUrl: null,
    isPublic: false,
    trackCount: entries.length,
    covers: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ownerId: 'u1',
    isOwner: true,
    entries,
    ...overrides,
  };
}

let requests: ReturnType<typeof stubApi>['requests'];
let current: PlaylistDetail;

beforeEach(() => {
  player.actions.reset();
  current = playlist();
  ({ requests } = stubApi({
    [`GET /api/playlists/${PID}`]: () => Response.json(current),
    [`PATCH /api/me/playlists/${PID}`]: ({ body }) => {
      current = { ...current, ...(body as object) };
      return Response.json(current);
    },
    [`DELETE /api/me/playlists/${PID}`]: noContent,
    [`DELETE /api/me/playlists/${PID}/tracks/e1`]: () => {
      current = { ...current, entries: current.entries.slice(1), trackCount: 1 };
      return noContent();
    },
    'GET /api/me/playlists': [],
    'GET /api/me/likes/ids': [],
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderPage() {
  const { wrapper } = queryWrapper();
  return render(<PlaylistPage />, { wrapper });
}

describe('Playlist page (owner)', () => {
  test('shows the playlist with reorder handles', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Night drive' })).toBeInTheDocument();
    expect(screen.getByText('For the long way home')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reorder / })).toHaveLength(2);
  });

  test('renames and makes it public', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Late drive');
    await userEvent.click(screen.getByRole('checkbox', { name: /Public/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Late drive' })).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      name: 'Late drive',
      description: 'For the long way home',
      isPublic: true,
    });
  });

  test('deletes after confirming, then leaves the page', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete playlist' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/library'));
    expect(
      requests.some((r) => r.method === 'DELETE' && r.path === `/api/me/playlists/${PID}`),
    ).toBe(true);
  });

  test('removes one entry from its menu', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'More options for Track 1' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Remove from this playlist' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Play Track 1' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Play Track 2' })).toBeInTheDocument();
  });

  test('an empty playlist points to search', async () => {
    current = playlist({ entries: [], trackCount: 0 });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Find tracks' })).toHaveAttribute(
      'href',
      '/search',
    );
  });
});

test('someone else’s public playlist is read-only', async () => {
  current = playlist({ isOwner: false, isPublic: true, ownerId: 'u2' });
  renderPage();
  expect(await screen.findByText('Public playlist')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Reorder / })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'More options for Track 1' }));
  await screen.findByRole('menuitem', { name: 'Add to queue' });
  expect(
    screen.queryByRole('menuitem', { name: 'Remove from this playlist' }),
  ).not.toBeInTheDocument();
});
