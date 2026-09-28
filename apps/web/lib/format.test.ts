import { expect, test } from 'vitest';
import { artistNames, formatCount, formatDuration } from './format';

test.each([
  [0, '0:00'],
  [7.9, '0:07'],
  [205, '3:25'],
  [3729, '1:02:09'],
  [null, '0:00'],
  [Number.NaN, '0:00'],
  [Number.POSITIVE_INFINITY, '0:00'],
  [-4, '0:00'],
])('formatDuration(%s) is %s', (input, expected) => {
  expect(formatDuration(input)).toBe(expected);
});

test('formatCount is compact', () => {
  expect(formatCount(950)).toBe('950');
  expect(formatCount(1234)).toBe('1.2K');
  expect(formatCount(3_400_000)).toBe('3.4M');
});

test('artistNames joins names', () => {
  expect(artistNames([{ name: 'A' }, { name: 'B' }])).toBe('A, B');
  expect(artistNames([])).toBe('');
});
