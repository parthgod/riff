import type { StreamInfo, Track } from '@riff/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeMedia } from '@/test/fake-media';
import { station, track } from '@/test/fixtures';
import { AudioEngine, type EngineEvents, STALL_TIMEOUT_MS } from './engine';

const info = (url: string, mirrors: string[] = []): StreamInfo => ({ url, mirrors, live: false });

let media: FakeMedia;
let resolve: ReturnType<typeof vi.fn<(id: string) => Promise<StreamInfo>>>;
let events: { [K in keyof EngineEvents]: ReturnType<typeof vi.fn<EngineEvents[K]>> };
let engine: AudioEngine;

beforeEach(() => {
  media = new FakeMedia();
  resolve = vi.fn(async (id: string) => info(`https://a.test/${id}`, [`https://b.test/${id}`]));
  events = {
    onStatus: vi.fn(),
    onTime: vi.fn(),
    onDuration: vi.fn(),
    onEnded: vi.fn(),
    onFailed: vi.fn(),
  };
  engine = new AudioEngine(media, resolve, events);
});

/** Lets pending promise callbacks (resolve, play) run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

async function playing(t: Track, startAt = 0) {
  await engine.load(t, { autoplay: true, startAt });
  media.emit('loadedmetadata');
  media.emit('playing');
}

describe('load', () => {
  test('resolves the stream, sets the source and plays', async () => {
    await engine.load(track(1), { autoplay: true });
    expect(resolve).toHaveBeenCalledWith('audius:t1');
    expect(media.src).toBe('https://a.test/audius:t1');
    expect(media.paused).toBe(false);
    expect(events.onStatus).toHaveBeenCalledWith('loading');
    media.emit('playing');
    expect(events.onStatus).toHaveBeenLastCalledWith('playing');
    expect(engine.loadedTrackId).toBe('audius:t1');
  });

  test('without autoplay, loads paused and seeks to the start position once metadata is in', async () => {
    await engine.load(track(1), { autoplay: false, startAt: 42 });
    expect(media.paused).toBe(true);
    media.emit('loadedmetadata');
    expect(media.currentTime).toBe(42);
  });

  test('reports a failed resolution without touching the element', async () => {
    resolve.mockRejectedValueOnce(new Error('502'));
    await engine.load(track(1), { autoplay: true });
    expect(events.onFailed).toHaveBeenCalledOnce();
    expect(media.srcHistory).toEqual([]);
  });

  test('ignores a resolution that finishes after another track was loaded', async () => {
    let release: (value: StreamInfo) => void = () => {};
    resolve.mockImplementationOnce(() => new Promise((done) => (release = done)));
    const first = engine.load(track(1), { autoplay: true });
    await engine.load(track(2), { autoplay: true });
    release(info('https://a.test/stale'));
    await first;
    expect(media.src).toBe('https://a.test/audius:t2');
    expect(engine.loadedTrackId).toBe('audius:t2');
  });

  test('a blocked autoplay leaves the player paused', async () => {
    media.playResult = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    await engine.load(track(1), { autoplay: true });
    await settle();
    expect(events.onStatus).toHaveBeenLastCalledWith('paused');
  });
});

describe('failover', () => {
  test('tries the next mirror at the same position', async () => {
    await playing(track(1));
    media.currentTime = 61;
    media.emit('timeupdate');
    media.currentTime = 0;
    media.emit('error');
    expect(media.src).toBe('https://b.test/audius:t1');
    media.emit('loadedmetadata');
    expect(media.currentTime).toBe(61);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test('when every mirror fails, resolves again once and resumes where it was', async () => {
    resolve
      .mockResolvedValueOnce(info('https://a.test/old', ['https://b.test/old']))
      .mockResolvedValueOnce(info('https://a.test/fresh'));
    await playing(track(1));
    media.currentTime = 90;
    media.emit('timeupdate');
    media.emit('error');
    media.emit('error');
    await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(media.src).toBe('https://a.test/fresh');
    media.emit('loadedmetadata');
    expect(media.currentTime).toBe(90);
    expect(media.paused).toBe(false);
    expect(events.onFailed).not.toHaveBeenCalled();
  });

  test('gives up after the fresh resolution fails too', async () => {
    await playing(track(1));
    for (let i = 0; i < 4; i++) {
      media.emit('error');
      await settle();
    }
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(events.onFailed).toHaveBeenCalledOnce();
    expect(events.onFailed.mock.calls[0]?.[0]).toMatchObject({ id: 'audius:t1' });
  });

  test('recovers from a second expiry later in the same track', async () => {
    await playing(track(1));
    // First expiry: both mirrors fail, a fresh resolution plays.
    media.emit('error');
    media.emit('error');
    await settle();
    media.emit('playing');
    // Much later, the fresh URL expires as well.
    media.emit('error');
    media.emit('error');
    await settle();
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(events.onFailed).not.toHaveBeenCalled();
  });

  test('a source that never starts playing counts as failed', async () => {
    vi.useFakeTimers();
    try {
      await engine.load(track(1), { autoplay: true });
      expect(media.src).toBe('https://a.test/audius:t1');
      vi.advanceTimersByTime(STALL_TIMEOUT_MS);
      expect(media.src).toBe('https://b.test/audius:t1');
      // Audio arriving in time cancels the watchdog.
      media.emit('playing');
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);
      expect(media.src).toBe('https://b.test/audius:t1');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a stall mid-track (waiting with no progress) fails over too', async () => {
    vi.useFakeTimers();
    try {
      await playing(track(1));
      media.currentTime = 40;
      media.emit('timeupdate');
      media.emit('waiting');
      vi.advanceTimersByTime(STALL_TIMEOUT_MS);
      expect(media.src).toBe('https://b.test/audius:t1');
      media.emit('loadedmetadata');
      expect(media.currentTime).toBe(40);
    } finally {
      vi.useRealTimers();
    }
  });

  test('pausing while loading does not count as a stall', async () => {
    vi.useFakeTimers();
    try {
      await engine.load(track(1), { autoplay: true });
      engine.pause();
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);
      expect(media.srcHistory).toEqual(['https://a.test/audius:t1']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('ignores errors when nothing is loaded', () => {
    media.emit('error');
    expect(events.onFailed).not.toHaveBeenCalled();
  });
});

describe('prefetch', () => {
  test('the next load uses the prefetched stream instead of resolving again', async () => {
    await engine.prefetch(track(2));
    expect(resolve).toHaveBeenCalledTimes(1);
    await engine.load(track(2), { autoplay: true });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(media.src).toBe('https://a.test/audius:t2');
  });

  test('a prefetched stream is used once', async () => {
    await engine.prefetch(track(2));
    await engine.load(track(2), { autoplay: true });
    await engine.load(track(2), { autoplay: true });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  test('stale prefetches are dropped', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    await engine.prefetch(track(2));
    now.mockReturnValue(10 * 60_000);
    await engine.load(track(2), { autoplay: true });
    expect(resolve).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  test('a failed prefetch is silent', async () => {
    resolve.mockRejectedValueOnce(new Error('offline'));
    await expect(engine.prefetch(track(2))).resolves.toBeUndefined();
    expect(events.onFailed).not.toHaveBeenCalled();
  });

  test('live stations are never prefetched (resolution counts as a listen)', async () => {
    await engine.prefetch(station(1));
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('controls and element events', () => {
  test('seek moves the element and is ignored for live stations', async () => {
    await playing(track(1));
    engine.seek(30);
    expect(media.currentTime).toBe(30);
    await playing(station(1));
    media.currentTime = 5;
    engine.seek(100);
    expect(media.currentTime).toBe(5);
  });

  test('live streams never restore a position', async () => {
    await playing(station(1), 300);
    expect(media.currentTime).toBe(0);
  });

  test('reports time, duration (null for live), waiting, pause and end', async () => {
    await playing(track(1));
    media.currentTime = 12.5;
    media.emit('timeupdate');
    expect(events.onTime).toHaveBeenLastCalledWith(12.5);
    media.duration = 180;
    media.emit('durationchange');
    expect(events.onDuration).toHaveBeenLastCalledWith(180);
    media.duration = Number.POSITIVE_INFINITY;
    media.emit('durationchange');
    expect(events.onDuration).toHaveBeenLastCalledWith(null);
    media.emit('waiting');
    expect(events.onStatus).toHaveBeenLastCalledWith('loading');
    media.paused = true;
    media.emit('pause');
    expect(events.onStatus).toHaveBeenLastCalledWith('paused');
    media.ended = true;
    media.emit('pause');
    media.emit('ended');
    expect(events.onStatus).toHaveBeenLastCalledWith('paused');
    expect(events.onEnded).toHaveBeenCalledOnce();
  });

  test('play, pause, volume and mute drive the element', async () => {
    await engine.load(track(1), { autoplay: false });
    await engine.play();
    expect(media.paused).toBe(false);
    engine.pause();
    expect(media.paused).toBe(true);
    engine.setVolume(0.25);
    engine.setMuted(true);
    expect(media.volume).toBe(0.25);
    expect(media.muted).toBe(true);
  });

  test('unload clears the source; destroy removes every listener', async () => {
    await playing(track(1));
    engine.unload();
    expect(media.src).toBe('');
    expect(engine.loadedTrackId).toBeNull();
    engine.destroy();
    expect(media.listenerCount()).toBe(0);
  });
});
