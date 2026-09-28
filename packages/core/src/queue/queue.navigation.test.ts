import { describe, expect, test } from 'vitest';
import * as q from './queue';
import { ctx, currentId, ids, testEnv, track, tracks } from './test-helpers';
import type { QueueState } from './types';

describe('playContext', () => {
  test('starts at the chosen index and queues the rest of the context', () => {
    const s = q.playContext(q.emptyQueue, tracks(4), 1, ctx, testEnv());
    expect(currentId(s)).toBe('audius:t2');
    expect(ids(q.upcoming(s))).toEqual(['audius:t3', 'audius:t4']);
    expect(s.context).toEqual(ctx);
  });

  test('clamps out-of-range start indexes', () => {
    expect(currentId(q.playContext(q.emptyQueue, tracks(3), 99, ctx, testEnv()))).toBe('audius:t3');
    expect(currentId(q.playContext(q.emptyQueue, tracks(3), -5, ctx, testEnv()))).toBe('audius:t1');
  });

  test('treats a NaN start index as the first track', () => {
    const s = q.playContext(q.emptyQueue, tracks(3), Number.NaN, ctx, testEnv());
    expect(currentId(s)).toBe('audius:t1');
    expect(s.index).toBe(0);
  });

  test('ignores an empty context', () => {
    expect(q.playContext(q.emptyQueue, [], 0, ctx, testEnv())).toBe(q.emptyQueue);
  });

  test('keeps items the user already queued', () => {
    const env = testEnv();
    const queued = q.addToQueue(q.emptyQueue, [track(9)], env);
    const s = q.playContext(queued, tracks(2), 0, ctx, env);
    expect(ids(q.upcoming(s))).toEqual(['audius:t9', 'audius:t2']);
  });

  test('gives duplicate tracks distinct uids', () => {
    const s = q.playContext(q.emptyQueue, [track(1), track(1)], 0, ctx, testEnv());
    expect(new Set(s.order.map((item) => item.uid)).size).toBe(2);
  });

  test('with shuffle on, plays the chosen track first and every other track once', () => {
    const s = q.playContext({ ...q.emptyQueue, shuffle: true }, tracks(8), 3, ctx, testEnv());
    expect(currentId(s)).toBe('audius:t4');
    expect(s.index).toBe(0);
    expect([...ids(s.order)].sort()).toEqual([...ids(s.original)].sort());
    expect(ids(s.original)).toEqual(tracks(8).map((t) => t.id));
  });
});

describe('next', () => {
  test('walks the context, then stops at the end with repeat off', () => {
    const env = testEnv();
    const first = q.next(q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), env);
    expect(first.effect).toBe('play');
    expect(currentId(first.state)).toBe('audius:t2');
    const end = q.next(first.state, env);
    expect(end.effect).toBe('stop');
    expect(currentId(end.state)).toBe('audius:t2');
  });

  test('plays queued items first, then resumes the context where it left off', () => {
    const env = testEnv();
    const s = q.addToQueue(
      q.playContext(q.emptyQueue, tracks(3), 0, ctx, env),
      [track(8), track(9)],
      env,
    );
    const a = q.next(s, env);
    expect(currentId(a.state)).toBe('audius:t8');
    expect(a.state.currentFromUpNext).toBe(true);
    const b = q.next(a.state, env);
    expect(currentId(b.state)).toBe('audius:t9');
    const c = q.next(b.state, env);
    expect(currentId(c.state)).toBe('audius:t2');
    expect(c.state.currentFromUpNext).toBe(false);
  });

  test('playNext puts items ahead of earlier queued items', () => {
    const env = testEnv();
    const base = q.addToQueue(q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), [track(8)], env);
    const s = q.playNext(base, [track(9)], env);
    expect(ids(q.upcoming(s))).toEqual(['audius:t9', 'audius:t8', 'audius:t2']);
  });

  test('wraps to the start with repeat all', () => {
    const env = testEnv();
    const s: QueueState = { ...q.playContext(q.emptyQueue, tracks(2), 1, ctx, env), repeat: 'all' };
    const step = q.next(s, env);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).toBe('audius:t1');
    expect(step.state.index).toBe(0);
  });

  test('reshuffles on wrap with shuffle + repeat all, never replaying the last track first', () => {
    const env = testEnv(7);
    let s: QueueState = {
      ...q.playContext({ ...q.emptyQueue, shuffle: true }, tracks(5), 0, ctx, env),
      repeat: 'all',
    };
    for (let i = 0; i < 4; i++) s = q.next(s, env).state;
    const last = s.current;
    const step = q.next(s, env);
    expect(step.effect).toBe('play');
    expect(step.state.current?.uid).not.toBe(last?.uid);
    expect([...ids(step.state.order)].sort()).toEqual(
      tracks(5)
        .map((t) => t.id)
        .sort(),
    );
  });

  test('on wrap, never starts the new cycle with the last context track, even after a queued one', () => {
    const base = testEnv();
    const rolls = [0, 0.99]; // shuffles [t1, t2, t3] into [t3, t2, t1]
    const env = { uid: base.uid, rng: () => rolls.shift() ?? 0 };
    let s: QueueState = {
      ...q.playContext(q.emptyQueue, tracks(3), 2, ctx, env),
      shuffle: true,
      repeat: 'all',
    };
    s = q.next(q.addToQueue(s, [track(9)], env), env).state;
    expect(currentId(s)).toBe('audius:t9');
    const step = q.next(s, env);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).not.toBe('audius:t3');
  });

  test('stops on an empty queue', () => {
    expect(q.next(q.emptyQueue, testEnv()).effect).toBe('stop');
  });
});

describe('trackEnded', () => {
  test('restarts the same track with repeat one', () => {
    const env = testEnv();
    const s: QueueState = { ...q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), repeat: 'one' };
    expect(q.trackEnded(s, env)).toEqual({ state: s, effect: 'restart' });
  });

  test('advances otherwise; an explicit next() still skips under repeat one', () => {
    const env = testEnv();
    const s = q.playContext(q.emptyQueue, tracks(2), 0, ctx, env);
    expect(currentId(q.trackEnded(s, env).state)).toBe('audius:t2');
    expect(currentId(q.next({ ...s, repeat: 'one' }, env).state)).toBe('audius:t2');
  });
});

describe('prev', () => {
  const env = testEnv();
  const atSecond = q.next(q.playContext(q.emptyQueue, tracks(3), 0, ctx, env), env).state;

  test('restarts when more than 3 seconds in', () => {
    expect(q.prev(atSecond, 3.5).effect).toBe('restart');
  });

  test('goes to the previous context track near the start', () => {
    const step = q.prev(atSecond, 1);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).toBe('audius:t1');
  });

  test('restarts on the first track', () => {
    const first = q.playContext(q.emptyQueue, tracks(3), 0, ctx, testEnv());
    expect(q.prev(first, 0).effect).toBe('restart');
  });

  test('returns to the context track that played before a queued item', () => {
    const e = testEnv();
    const s = q.next(
      q.addToQueue(q.playContext(q.emptyQueue, tracks(3), 1, ctx, e), [track(9)], e),
      e,
    ).state;
    expect(currentId(s)).toBe('audius:t9');
    const step = q.prev(s, 0);
    expect(currentId(step.state)).toBe('audius:t2');
    expect(step.state.currentFromUpNext).toBe(false);
  });

  test('does nothing when nothing is loaded', () => {
    expect(q.prev(q.emptyQueue, 0).effect).toBe('none');
  });
});

describe('repeat and selectors', () => {
  test('cycleRepeat goes off → all → one → off', () => {
    const a = q.cycleRepeat(q.emptyQueue);
    const b = q.cycleRepeat(a);
    const c = q.cycleRepeat(b);
    expect([a.repeat, b.repeat, c.repeat]).toEqual(['all', 'one', 'off']);
  });

  test('hasNext accounts for queued items and repeat all', () => {
    const env = testEnv();
    const last = q.playContext(q.emptyQueue, tracks(2), 1, ctx, env);
    expect(q.hasNext(last)).toBe(false);
    expect(q.hasNext({ ...last, repeat: 'all' })).toBe(true);
    expect(q.hasNext(q.addToQueue(last, [track(5)], env))).toBe(true);
  });

  test('state survives a JSON round trip (used for persistence)', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(3), 1, ctx, env), [track(7)], env);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
