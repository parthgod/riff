import { type QueueContext, queue as q, type StreamInfo } from '@riff/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeMedia } from '@/test/fake-media';
import { station, track, tracks } from '@/test/fixtures';
import { AudioEngine } from './engine';
import type { RecordPlay } from './play-tracker';
import { createPlayer, type Player } from './player';

const ctx: QueueContext = { type: 'playlist', id: 'p1', name: 'Mix' };

let media: FakeMedia;
let resolve: ReturnType<typeof vi.fn<(id: string) => Promise<StreamInfo>>>;
let record: ReturnType<typeof vi.fn<RecordPlay>>;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
let player: Player;

beforeEach(() => {
  media = new FakeMedia();
  resolve = vi.fn(async (id: string) => ({
    url: `https://a.test/${id}`,
    mirrors: [],
    live: false,
  }));
  record = vi.fn<RecordPlay>(async () => {});
  notify = vi.fn();
  let uid = 0;
  player = createPlayer({
    createEngine: (events) => new AudioEngine(media, resolve, events),
    env: { rng: () => 0.5, uid: () => `u${++uid}` },
    recordPlay: record,
    notify,
  });
});

const state = () => player.store.getState();
const currentId = () => state().queue.current?.track.id;
const settle = () => new Promise((done) => setTimeout(done, 0));

async function started() {
  await settle();
  media.emit('loadedmetadata');
  media.emit('playing');
}

describe('playback', () => {
  test('playContext loads and plays the chosen track', async () => {
    player.actions.playContext(tracks(3), 1, ctx);
    expect(state().status).toBe('loading');
    expect(state().duration).toBe(180);
    await started();
    expect(media.src).toBe('https://a.test/audius:t2');
    expect(state().status).toBe('playing');
    expect(currentId()).toBe('audius:t2');
  });

  test('an empty context changes nothing', () => {
    player.actions.playContext([], 0, ctx);
    expect(state().status).toBe('idle');
    expect(resolve).not.toHaveBeenCalled();
  });

  test('when a track ends, the next one plays', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    media.emit('ended');
    await started();
    expect(currentId()).toBe('audius:t2');
    expect(media.src).toBe('https://a.test/audius:t2');
  });

  test('at the end of the queue with repeat off, the player stops on the last track', async () => {
    player.actions.playContext(tracks(1), 0, ctx);
    await started();
    media.ended = true;
    media.emit('pause');
    media.emit('ended');
    expect(state().status).toBe('ended');
    expect(currentId()).toBe('audius:t1');
    // Play again from the start.
    media.ended = false;
    media.currentTime = 180;
    player.actions.togglePlay();
    expect(media.currentTime).toBe(0);
    expect(media.paused).toBe(false);
  });

  test('repeat one replays the same track', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    player.actions.cycleRepeat();
    player.actions.cycleRepeat();
    expect(state().queue.repeat).toBe('one');
    await started();
    media.currentTime = 180;
    media.emit('ended');
    expect(currentId()).toBe('audius:t1');
    expect(media.currentTime).toBe(0);
    expect(media.paused).toBe(false);
  });

  test('prev restarts after 3 s and goes back before that', async () => {
    player.actions.playContext(tracks(2), 1, ctx);
    await started();
    media.currentTime = 10;
    media.emit('timeupdate');
    player.actions.prev();
    expect(media.currentTime).toBe(0);
    expect(currentId()).toBe('audius:t2');
    media.emit('timeupdate');
    player.actions.prev();
    expect(currentId()).toBe('audius:t1');
  });

  test('togglePlay pauses and resumes', async () => {
    player.actions.playContext(tracks(1), 0, ctx);
    await started();
    player.actions.togglePlay();
    expect(media.paused).toBe(true);
    expect(state().status).toBe('paused');
    player.actions.togglePlay();
    expect(media.paused).toBe(false);
  });

  test('seek clamps to the track and updates the position at once', async () => {
    player.actions.playContext(tracks(1), 0, ctx);
    await started();
    player.actions.seek(500);
    expect(media.currentTime).toBe(180);
    expect(state().position).toBe(180);
    player.actions.seek(-5);
    expect(media.currentTime).toBe(0);
  });

  test('live stations cannot seek or go back', async () => {
    player.actions.playContext([station(1), station(2)], 1, {
      type: 'radio',
      name: 'Radio',
    });
    await started();
    expect(state().duration).toBeNull();
    media.currentTime = 100;
    media.emit('timeupdate');
    player.actions.seek(10);
    player.actions.prev();
    expect(media.currentTime).toBe(100);
    expect(currentId()).toBe(station(2).id);
  });

  test('adding to an idle queue starts playing it', async () => {
    player.actions.addToQueue([track(7)]);
    await started();
    expect(currentId()).toBe('audius:t7');
    expect(state().status).toBe('playing');
  });

  test('queued items play before the context continues', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    player.actions.playNext([track(9)]);
    await started();
    media.emit('ended');
    expect(currentId()).toBe('audius:t9');
  });

  test('the old track ending while the chosen one resolves does not skip it', async () => {
    player.actions.playContext(tracks(5), 0, ctx);
    await started();
    let release: (value: StreamInfo) => void = () => {};
    resolve.mockImplementationOnce(() => new Promise((done) => (release = done)));
    player.actions.jumpTo(state().queue.order[2]?.uid as string);
    media.emit('ended');
    release({ url: 'https://a.test/audius:t3', mirrors: [], live: false });
    await started();
    expect(currentId()).toBe('audius:t3');
    expect(media.src).toBe('https://a.test/audius:t3');
  });
});

describe('failures', () => {
  test('a track that cannot play is announced and skipped', async () => {
    resolve.mockRejectedValueOnce(new Error('502'));
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    expect(notify).toHaveBeenCalledWith('Couldn’t play “Track 1”. Skipping.');
    expect(currentId()).toBe('audius:t2');
    expect(state().status).toBe('playing');
  });

  test('stops instead of skipping through the whole queue when nothing plays', async () => {
    resolve.mockRejectedValue(new Error('offline'));
    player.actions.playContext(tracks(10), 0, ctx);
    await settle();
    await settle();
    await settle();
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(state().status).toBe('error');
    expect(notify).toHaveBeenLastCalledWith(
      'Playback stopped: several tracks in a row failed. Check your connection.',
    );
  });

  test('a failure after the listener paused moves on but stays paused', async () => {
    let fail: (error: Error) => void = () => {};
    resolve.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    player.actions.playContext(tracks(3), 0, ctx);
    player.actions.togglePlay();
    fail(new Error('502'));
    await settle();
    expect(currentId()).toBe('audius:t2');
    expect(state()).toMatchObject({ status: 'paused', position: 0 });
    expect(media.paused).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
    player.actions.togglePlay();
    await started();
    expect(media.src).toBe('https://a.test/audius:t2');
    expect(state().status).toBe('playing');
  });

  test('a failure on the last track leaves the player in the error state', async () => {
    resolve.mockRejectedValue(new Error('502'));
    player.actions.playContext(tracks(1), 0, ctx);
    await settle();
    expect(state().status).toBe('error');
  });
});

describe('volume', () => {
  test('maps the slider to a perceptual gain and unmutes when raised', () => {
    player.actions.toggleMute();
    expect(media.muted).toBe(true);
    player.actions.setVolume(0.5);
    expect(media.volume).toBe(0.25);
    expect(state().volume).toBe(0.5);
    expect(state().muted).toBe(false);
    expect(media.muted).toBe(false);
  });
});

describe('history and prefetch', () => {
  test('records the play with its context after 30 s of listening', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    for (let t = 0; t <= 31; t += 0.25) {
      media.currentTime = t;
      media.emit('timeupdate');
    }
    expect(record).toHaveBeenCalledWith({
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:p1',
    });
  });

  test('queued items are recorded without the context', async () => {
    player.actions.addToQueue([track(7)]);
    await started();
    for (let t = 0; t <= 31; t += 0.25) {
      media.currentTime = t;
      media.emit('timeupdate');
    }
    expect(record).toHaveBeenCalledWith({ trackId: 'audius:t7', msPlayed: 30_000 });
  });

  test('prefetches the next track once the current one plays', async () => {
    player.actions.playContext(tracks(3), 0, ctx);
    await started();
    await settle();
    expect(resolve).toHaveBeenCalledWith('audius:t2');
    media.emit('ended');
    await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe('restore and reset', () => {
  test('restores paused at the saved position and loads only on play', async () => {
    const queue = q.playContext(q.emptyQueue, tracks(3), 1, ctx, { rng: () => 0, uid: () => 'x' });
    player.actions.restore({ queue, position: 75, volume: 0.8, muted: false });
    expect(state()).toMatchObject({ status: 'paused', position: 75, volume: 0.8 });
    expect(media.volume).toBeCloseTo(0.64);
    expect(resolve).not.toHaveBeenCalled();
    player.actions.togglePlay();
    await started();
    expect(media.src).toBe('https://a.test/audius:t2');
    expect(media.currentTime).toBe(75);
  });

  test('restoring an empty queue leaves the player idle', () => {
    player.actions.restore({ queue: q.emptyQueue, position: 0, volume: 1, muted: false });
    expect(state().status).toBe('idle');
  });

  test('reset stops playback and forgets the queue', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    player.actions.reset();
    expect(media.src).toBe('');
    expect(state().queue).toEqual(q.emptyQueue);
    expect(state().status).toBe('idle');
  });
});
