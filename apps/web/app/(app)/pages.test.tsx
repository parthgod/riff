import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiError, noContent, stubApi } from '@/test/api-stub';
import { station, track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import ArtistPage from './artist/[id]/page';
import CollectionPage from './collection/[id]/page';
import GenrePage from './genre/[genre]/page';
import HomePage from './page';
import RadioPage from './radio/page';
import SearchPage from './search/page';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const nav = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  search: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useSearchParams: () => nav.search,
  useRouter: () => nav.router,
  usePathname: () => '/search',
}));

const ok = { audius: 'ok', jamendo: 'disabled', radio: 'ok' };
const emptyHome = { recentlyPlayed: [], topGenres: [], fromFollowed: [], trending: [] };
const artist = {
  id: 'audius:a1',
  source: 'audius',
  name: 'Kaito',
  avatar: {},
  verified: true,
  followerCount: 1234,
  bio: 'Makes music at night.',
};

beforeEach(() => {
  player.actions.reset();
  nav.params = {};
  nav.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderPage(page: React.ReactElement) {
  const { wrapper } = queryWrapper();
  return render(page, { wrapper });
}

describe('Home', () => {
  test('shows only the sections that have tracks', async () => {
    stubApi({
      'GET /api/home': {
        ...emptyHome,
        topGenres: [{ genre: 'Lo-Fi', tracks: tracks(2) }],
        trending: [track(5)],
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Trending in Lo-Fi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/genre/Lo-Fi');
    expect(screen.getByRole('heading', { name: 'Trending this week' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recently played' })).not.toBeInTheDocument();
  });

  test('a card plays its shelf from that track', async () => {
    stubApi({
      'GET /api/home': { ...emptyHome, recentlyPlayed: tracks(3) },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<HomePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Play Track 2' }));
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t2');
    expect(player.store.getState().queue.context?.type).toBe('history');
  });

  test('a failure offers a retry', async () => {
    stubApi({ 'GET /api/home': () => apiError(500, 'INTERNAL', 'Something went wrong') });
    renderPage(<HomePage />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Search', () => {
  test('with no query, shows the genre grid', () => {
    stubApi({});
    renderPage(<SearchPage />);
    expect(screen.getByRole('heading', { name: 'Browse genres' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hip-Hop/Rap' })).toHaveAttribute(
      'href',
      '/genre/Hip-Hop%2FRap',
    );
  });

  test('shows results by kind and names a failed source', async () => {
    nav.search = new URLSearchParams('q=night');
    stubApi({
      'GET /api/search': {
        tracks: [track(1)],
        artists: [artist],
        collections: [],
        stations: [station(1)],
        sources: { audius: 'ok', jamendo: 'error', radio: 'ok' },
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<SearchPage />);
    expect(await screen.findByRole('heading', { name: 'Tracks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Artists' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Radio stations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Albums and playlists' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Jamendo is unavailable');
  });

  test('says when nothing matched', async () => {
    nav.search = new URLSearchParams('q=zzqx');
    stubApi({
      'GET /api/search': { tracks: [], artists: [], collections: [], stations: [], sources: ok },
    });
    renderPage(<SearchPage />);
    expect(await screen.findByText('No results for “zzqx”')).toBeInTheDocument();
  });
});

describe('Genre', () => {
  test('switches the trending period', async () => {
    nav.params = { genre: 'Hip-Hop%2FRap' };
    const { requests } = stubApi({
      'GET /api/trending': { tracks: [track(1)], sources: ok },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<GenrePage />);
    expect(screen.getByRole('heading', { name: 'Hip-Hop/Rap' })).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Play Track 1' });
    await userEvent.click(screen.getByRole('tab', { name: 'All time' }));
    await screen.findByRole('button', { name: 'Play Track 1' });
    const trending = requests.filter((r) => r.path === '/api/trending');
    expect(trending.map((r) => r.query.get('window'))).toEqual(['week', 'allTime']);
    expect(trending.every((r) => r.query.get('genre') === 'Hip-Hop/Rap')).toBe(true);
  });
});

describe('Artist', () => {
  test('shows the artist and follows them', async () => {
    nav.params = { id: 'audius:a1' };
    const following: unknown[] = [];
    const { requests } = stubApi({
      'GET /api/artists/audius:a1': artist,
      'GET /api/artists/audius:a1/tracks': tracks(2),
      'GET /api/artists/audius:a1/related': [],
      'GET /api/me/following': () => Response.json(following),
      'PUT /api/me/following/audius:a1': () => {
        following.push(artist);
        return noContent();
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<ArtistPage />);
    expect(await screen.findByRole('heading', { name: 'Kaito' })).toBeInTheDocument();
    expect(screen.getByText('1.2K followers')).toBeInTheDocument();
    expect(screen.getByText('Makes music at night.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Follow' }));
    expect(await screen.findByRole('button', { name: 'Following' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(requests.some((r) => r.method === 'PUT')).toBe(true);
  });

  test('an unknown artist is a not-found page', async () => {
    nav.params = { id: 'audius:nope' };
    stubApi({
      'GET /api/artists/audius:nope': () => apiError(404, 'NOT_FOUND', 'No such artist'),
      'GET /api/artists/audius:nope/tracks': () => apiError(404, 'NOT_FOUND', 'No such artist'),
      'GET /api/artists/audius:nope/related': () => apiError(404, 'NOT_FOUND', 'No such artist'),
      'GET /api/me/following': [],
    });
    renderPage(<ArtistPage />);
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});

describe('Collection', () => {
  test('credits the owner and plays the collection', async () => {
    nav.params = { id: 'audius:album:7' };
    stubApi({
      'GET /api/collections/audius:album:7': {
        id: 'audius:album:7',
        source: 'audius',
        kind: 'album',
        title: 'Night Shift',
        artwork: {},
        owner: { id: 'audius:a1', name: 'Kaito' },
        tracks: tracks(2),
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<CollectionPage />);
    expect(await screen.findByRole('heading', { name: 'Night Shift' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kaito' })).toHaveAttribute(
      'href',
      '/artist/audius:a1',
    );
    expect(screen.getByText(/2 tracks, 6:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Play Night Shift' }));
    expect(player.store.getState().queue.context).toEqual({
      type: 'collection',
      id: 'audius:album:7',
      name: 'Night Shift',
    });
  });
});

describe('Radio', () => {
  test('lists popular stations, and searches by name', async () => {
    const { requests } = stubApi({
      'GET /api/radio/top': [station(1)],
      'GET /api/radio/search': [station(2)],
    });
    renderPage(<RadioPage />);
    const grid = await screen.findByRole('list');
    expect(within(grid).getByText('Station 1')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search stations' }), 'jazz');
    expect(await screen.findByText('Station 2')).toBeInTheDocument();
    expect(requests.find((r) => r.path === '/api/radio/search')?.query.get('q')).toBe('jazz');
  });

  test('plays a station', async () => {
    stubApi({ 'GET /api/radio/top': [station(1), station(2)] });
    renderPage(<RadioPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Play Station 2' }));
    act(() => undefined);
    expect(player.store.getState().queue.current?.track.isLive).toBe(true);
  });
});
