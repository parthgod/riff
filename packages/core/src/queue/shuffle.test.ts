import { expect, test } from 'vitest';
import { shuffled } from './shuffle';
import { testEnv } from './test-helpers';

test('returns a permutation without mutating the input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const copy = input.slice();
  const out = shuffled(input, testEnv(3).rng);
  expect(input).toEqual(copy);
  expect([...out].sort((a, b) => a - b)).toEqual(copy);
  expect(out).not.toEqual(copy);
});

test('stays in bounds for rng values at the edges of [0, 1)', () => {
  expect(shuffled([1, 2, 3], () => 0).sort()).toEqual([1, 2, 3]);
  expect(shuffled([1, 2, 3], () => 0.999_999).sort()).toEqual([1, 2, 3]);
  expect(shuffled([], () => 0.5)).toEqual([]);
});
