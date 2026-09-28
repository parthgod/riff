import { describe, expect, test } from 'vitest';
import * as q from './queue';
import { QueueStateSchema } from './schema';
import { ctx, testEnv, track, tracks } from './test-helpers';
import type { QueueState } from './types';

const roundTrip = (state: QueueState): unknown => JSON.parse(JSON.stringify(state));

function playing(): QueueState {
  const env = testEnv();
  return q.addToQueue(q.playContext(q.emptyQueue, tracks(3), 1, ctx, env), [track(7)], env);
}

describe('QueueStateSchema', () => {
  test('accepts the empty queue and real states after a JSON round trip', () => {
    const env = testEnv();
    const fromUpNext = q.next(playing(), env).state;
    for (const state of [q.emptyQueue, playing(), fromUpNext]) {
      expect(QueueStateSchema.parse(roundTrip(state))).toEqual(state);
    }
  });

  test.each([
    ['an index past the end of order', (s: QueueState) => ({ ...s, index: s.order.length })],
    ['an index below -1', (s: QueueState) => ({ ...s, index: -2 })],
    ['a current item that is not order[index]', (s: QueueState) => ({ ...s, current: s.order[0] })],
    ['an unknown repeat mode', (s: QueueState) => ({ ...s, repeat: 'forever' })],
    ['an unknown context type', (s: QueueState) => ({ ...s, context: { type: 'x', name: 'x' } })],
    [
      'a malformed track',
      (s: QueueState) => ({ ...s, upNext: [{ uid: 'u9', track: { id: 'nope' } }] }),
    ],
  ])('rejects %s', (_, corrupt) => {
    expect(QueueStateSchema.safeParse(corrupt(roundTrip(playing()) as QueueState)).success).toBe(
      false,
    );
  });

  test('rejects values that are not queue states at all', () => {
    for (const value of [null, 42, 'queue', [], {}]) {
      expect(QueueStateSchema.safeParse(value).success).toBe(false);
    }
  });
});
