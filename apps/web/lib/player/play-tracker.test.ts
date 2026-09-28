import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PlayTracker, type RecordPlay } from './play-tracker';

let record: ReturnType<typeof vi.fn<RecordPlay>>;
let tracker: PlayTracker;

beforeEach(() => {
  record = vi.fn<RecordPlay>(async () => {});
  tracker = new PlayTracker(record);
});

/** Plays from `from` to `to` in 0.25 s steps, like the element's timeupdate events. */
function listen(from: number, to: number, audible = true) {
  for (let t = from; t <= to; t += 0.25) tracker.onTime(t, audible);
}

describe('PlayTracker', () => {
  test('records a play once 30 s have been heard, and only once', () => {
    tracker.start('audius:t1', 'playlist:p1');
    listen(0, 29.5);
    expect(record).not.toHaveBeenCalled();
    listen(29.75, 60);
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:p1',
    });
  });

  test('counts listening time, not position: seeking ahead does not count', () => {
    tracker.start('audius:t1');
    listen(0, 10);
    tracker.onSeek(170);
    listen(170, 179);
    tracker.onEnded();
    expect(record).toHaveBeenCalledWith({ trackId: 'audius:t1', msPlayed: 19_000 });
  });

  test('seeking back and listening again counts again', () => {
    tracker.start('audius:t1');
    listen(0, 20);
    tracker.onSeek(0);
    listen(0, 10);
    expect(record).toHaveBeenCalledOnce();
  });

  test('time while muted or paused does not count', () => {
    tracker.start('audius:t1');
    listen(0, 40, false);
    expect(record).not.toHaveBeenCalled();
  });

  test('a short track is recorded when it ends', () => {
    tracker.start('audius:t1');
    listen(0, 12);
    tracker.onEnded();
    expect(record).toHaveBeenCalledWith({ trackId: 'audius:t1', msPlayed: 12_000 });
  });

  test('nothing is recorded for a track that never played', () => {
    tracker.start('audius:t1');
    tracker.onEnded();
    tracker.start('audius:t2');
    expect(record).not.toHaveBeenCalled();
  });

  test('starting a new play resets the count', () => {
    tracker.start('audius:t1');
    listen(0, 20);
    tracker.start('audius:t2');
    listen(0, 20);
    expect(record).not.toHaveBeenCalled();
  });

  test('a failed post is swallowed', async () => {
    record.mockRejectedValueOnce(new Error('offline'));
    tracker.start('audius:t1');
    listen(0, 31);
    await Promise.resolve();
    expect(record).toHaveBeenCalledOnce();
  });
});
