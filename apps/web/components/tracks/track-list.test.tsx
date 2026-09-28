import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stubApi } from '@/test/api-stub';
import { station, track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { TrackList } from './track-list';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Night drive' };
const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

let requests: ReturnType<typeof stubApi>['requests'];

beforeEach(() => {
  player.actions.reset();
  ({ requests } = stubApi({
    'GET /api/me/likes/ids': [],
    'GET /api/me/playlists': [
      {
        id: PID,
        name: 'Gym',
        description: null,
        coverUrl: null,
        isPublic: false,
        trackCount: 0,
        covers: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
    [`POST /api/me/playlists/${PID}/tracks`]: () => Response.json({ entries: [] }, { status: 201 }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderList(list = tracks(3), props: Partial<Parameters<typeof TrackList>[0]> = {}) {
  const { wrapper } = queryWrapper();
  return render(<TrackList tracks={list} context={ctx} {...props} />, { wrapper });
}

const row = (title: string) =>
  screen.getAllByRole('listitem').find((r) => within(r).queryByText(title)) as HTMLElement;

describe('TrackList', () => {
  test('plays the list from the chosen row, with the list as context', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Play Track 2' }));
    const { queue } = player.store.getState();
    expect(queue.current?.track.id).toBe('audius:t2');
    expect(queue.context).toEqual(ctx);
    expect(queue.order.map((item) => item.track.id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
    ]);
  });

  test('marks the playing row, and its button pauses', () => {
    act(() => {
      player.actions.playContext(tracks(3), 1, ctx);
      player.store.setState({ status: 'playing' });
    });
    renderList();
    expect(row('Track 2')).toHaveAttribute('aria-current', 'true');
    const toggle = vi.spyOn(player.actions, 'togglePlay');
    fireEvent.click(screen.getByRole('button', { name: 'Pause Track 2' }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  test('the "…" menu queues tracks', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 3' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Play next' }));
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t3');
    expect(toast).toHaveBeenCalledWith('Playing next');
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 1' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to queue' }));
    expect(player.store.getState().queue.upNext.map((item) => item.track.id)).toEqual([
      'audius:t1',
    ]);
  });

  test('right-click opens the same menu, including Add to playlist', async () => {
    renderList();
    fireEvent.contextMenu(row('Track 2').firstElementChild as HTMLElement);
    const trigger = await screen.findByRole('menuitem', { name: 'Add to playlist' });
    trigger.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Gym' }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ trackIds: ['audius:t2'] }),
    );
  });

  test('offers removal only where the caller allows it', async () => {
    const onRemove = vi.fn();
    renderList(tracks(2), { onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 2' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Remove from this playlist' }),
    );
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  test('stations get a LIVE badge and no like or playlist actions', async () => {
    renderList([station(1)]);
    expect(within(row('Station 1')).getByText('LIVE')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More options for Station 1' }));
    await screen.findByRole('menuitem', { name: 'Add to queue' });
    expect(screen.queryByRole('menuitem', { name: 'Add to playlist' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Liked Songs/ })).not.toBeInTheDocument();
  });

  test('Go to artist navigates', async () => {
    renderList([track(4)]);
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 4' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Go to artist' }));
    expect(router.push).toHaveBeenCalledWith('/artist/audius:a4');
  });

  test('asks for more rows near the end', () => {
    const onEndReached = vi.fn();
    renderList(tracks(4), { onEndReached });
    expect(onEndReached).toHaveBeenCalled();
  });
});
