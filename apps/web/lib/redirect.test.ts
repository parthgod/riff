import { expect, test } from 'vitest';
import { safeNextPath, signInPath } from './redirect';

test.each([
  ['/liked', '/liked'],
  ['/search?q=lofi%20beats', '/search?q=lofi%20beats'],
  ['/playlist/1#top', '/playlist/1#top'],
])('keeps the in-app path %s', (next, expected) => {
  expect(safeNextPath(next)).toBe(expected);
});

test.each([
  [null],
  [''],
  ['liked'],
  ['//evil.example'],
  ['/\\evil.example'],
  ['/\t/evil.example'],
  ['https://evil.example/liked'],
  ['javascript:alert(1)'],
  ['/sign-in?next=/liked'],
  ['/sign-up'],
])('falls back to / for %j', (next) => {
  expect(safeNextPath(next)).toBe('/');
});

test('signInPath encodes the path to return to', () => {
  expect(signInPath('/search?q=a&b')).toBe('/sign-in?next=%2Fsearch%3Fq%3Da%26b');
});
