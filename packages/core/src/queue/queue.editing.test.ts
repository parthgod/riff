import { describe, expect, test } from 'vitest';
import * as q from './queue';
import { ctx, currentId, ids, testEnv, track, tracks } from './test-helpers';

describe('jumpTo', () => {
  test('jumping to a queued item drops the queued items before it', () => {
    const env = testEnv();
    const s = q.addToQueue(
      q.playContext(q.emptyQueue, tracks(2), 0, ctx, env),
      [track(7), track(8), track(9)],
      env,
    );
    const step = q.jumpTo(s, s.upNext[1]!.uid);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).toBe('audius:t8');
    expect(ids(q.upcoming(step.state))).toEqual(['audius:t9', 'audius:t2']);
  });

  test('jumping ahead in the context keeps queued items', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(4), 0, ctx, env), [track(9)], env);
    const step = q.jumpTo(s, s.order[2]!.uid);
    expect(currentId(step.state)).toBe('audius:t3');
    expect(step.state.index).toBe(2);
    expect(ids(q.upcoming(step.state))).toEqual(['audius:t9', 'audius:t4']);
  });

  test('ignores unknown or already-played uids', () => {
    const env = testEnv();
    const s = q.next(q.playContext(q.emptyQueue, tracks(3), 0, ctx, env), env).state;
    expect(q.jumpTo(s, 'nope').effect).toBe('none');
    expect(q.jumpTo(s, s.order[0]!.uid).effect).toBe('none');
  });
});

describe('removeFromQueue', () => {
  test('removes a queued item by uid, leaving a duplicate of the same track', () => {
    const env = testEnv();
    const s = q.addToQueue(
      q.playContext(q.emptyQueue, tracks(1), 0, ctx, env),
      [track(5), track(5)],
      env,
    );
    const out = q.removeFromQueue(s, s.upNext[0]!.uid);
    expect(ids(out.upNext)).toEqual(['audius:t5']);
    expect(out.upNext[0]!.uid).toBe(s.upNext[1]!.uid);
  });

  test('removes an upcoming context item from both order and original', () => {
    const env = testEnv();
    const s = q.playContext(q.emptyQueue, tracks(3), 0, ctx, env);
    const out = q.removeFromQueue(s, s.order[2]!.uid);
    expect(ids(out.order)).toEqual(['audius:t1', 'audius:t2']);
    expect(ids(out.original)).toEqual(['audius:t1', 'audius:t2']);
  });

  test('never removes the current or an already-played item', () => {
    const env = testEnv();
    const s = q.next(q.playContext(q.emptyQueue, tracks(3), 0, ctx, env), env).state;
    expect(q.removeFromQueue(s, s.order[0]!.uid)).toBe(s);
    expect(q.removeFromQueue(s, s.order[1]!.uid)).toBe(s);
  });
});

describe('moveInQueue and clearUpNext', () => {
  test('moves a queued item and clamps the destination', () => {
    const env = testEnv();
    const s = q.addToQueue(q.emptyQueue, [track(1), track(2), track(3)], env);
    expect(ids(q.moveInQueue(s, s.upNext[0]!.uid, 2).upNext)).toEqual([
      'audius:t2',
      'audius:t3',
      'audius:t1',
    ]);
    expect(ids(q.moveInQueue(s, s.upNext[2]!.uid, -10).upNext)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t2',
    ]);
    expect(q.moveInQueue(s, 'missing', 0)).toBe(s);
  });

  test('clearUpNext empties only the user queue', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), [track(9)], env);
    expect(ids(q.upcoming(q.clearUpNext(s)))).toEqual(['audius:t2']);
  });
});

describe('toggleShuffle', () => {
  test('turning on keeps the current track first and includes every context track once', () => {
    const env = testEnv();
    const s = q.playContext(q.emptyQueue, tracks(6), 2, ctx, env);
    const on = q.toggleShuffle(s, env);
    expect(on.shuffle).toBe(true);
    expect(on.index).toBe(0);
    expect(on.order[0]!.uid).toBe(s.current!.uid);
    expect([...ids(on.order)].sort()).toEqual([...ids(s.original)].sort());
    expect(on.original).toBe(s.original);
  });

  test('turning off restores context order positioned at the current track', () => {
    const env = testEnv();
    const shuffledState = q.toggleShuffle(q.playContext(q.emptyQueue, tracks(6), 2, ctx, env), env);
    const advanced = q.next(shuffledState, env).state;
    const off = q.toggleShuffle(advanced, env);
    expect(off.shuffle).toBe(false);
    expect(ids(off.order)).toEqual(tracks(6).map((t) => t.id));
    expect(off.order[off.index]!.uid).toBe(advanced.current!.uid);
  });

  test('works before anything from the context has played', () => {
    const env = testEnv();
    const on = q.toggleShuffle(q.addToQueue(q.emptyQueue, [track(1)], env), env);
    expect(on.index).toBe(-1);
    expect(on.order).toEqual([]);
  });
});
