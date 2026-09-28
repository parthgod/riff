import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ui } from '@/lib/ui-store';
import { stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { NowPlayingPanel, NowPlayingSheet } from './now-playing';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const withAlbum = track(1, {
  album: { id: 'audius:album:7', title: 'Night Shift' },
  permalink: 'https://audius.co/artist/track-1',
});

beforeEach(() => {
  player.actions.reset();
  ui.setNowPlayingOpen(false);
  stubApi({
    'GET /api/me/likes/ids': [],
    'GET /api/tracks/audius:t1/lyrics': { synced: null, plain: 'La la', instrumental: false },
  });
});

test('the panel credits the track, links the album and the source', () => {
  act(() => player.actions.playContext([withAlbum], 0, { type: 'search', name: 'Search' }));
  const { wrapper } = queryWrapper();
  render(<NowPlayingPanel />, { wrapper });
  expect(screen.getByRole('link', { name: 'Artist 1' })).toHaveAttribute(
    'href',
    '/artist/audius:a1',
  );
  expect(screen.getByRole('link', { name: 'Night Shift' })).toHaveAttribute(
    'href',
    '/collection/audius:album:7',
  );
  expect(screen.getByRole('link', { name: /Open on Audius/ })).toHaveAttribute(
    'href',
    'https://audius.co/artist/track-1',
  );
});

test('the phone sheet opens only with a track, titled by the context', async () => {
  const { wrapper } = queryWrapper();
  act(() => ui.setNowPlayingOpen(true));
  render(<NowPlayingSheet />, { wrapper });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(() => player.actions.playContext([withAlbum], 0, { type: 'liked', name: 'Liked Songs' }));
  expect(await screen.findByRole('dialog', { name: 'Liked Songs' })).toBeInTheDocument();
  expect(await screen.findByText('La la')).toBeInTheDocument();
});
