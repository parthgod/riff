import { describe, expect, test } from 'vitest';
import { findActiveLineIndex, parseLrc } from './lyrics';

describe('parseLrc', () => {
  test('parses 2- and 3-digit fractions and whole seconds', () => {
    expect(parseLrc('[00:30.75] One more time\n[01:02.123]Two\n[02:03]Three')).toEqual([
      { timeMs: 30_750, text: 'One more time' },
      { timeMs: 62_123, text: 'Two' },
      { timeMs: 123_000, text: 'Three' },
    ]);
  });

  test('expands lines with several timestamps and sorts by time', () => {
    expect(parseLrc('[00:10.00][00:05.00]Chorus\n[00:07.50]Verse')).toEqual([
      { timeMs: 5_000, text: 'Chorus' },
      { timeMs: 7_500, text: 'Verse' },
      { timeMs: 10_000, text: 'Chorus' },
    ]);
  });

  test('ignores metadata tags and untimed lines but keeps blank timed lines', () => {
    expect(parseLrc('[ar:Daft Punk]\n[ti:One More Time]\nno timestamp\n[00:33.18] ')).toEqual([
      { timeMs: 33_180, text: '' },
    ]);
  });

  test('handles CRLF line endings', () => {
    expect(parseLrc('[00:01.00]a\r\n[00:02.00]b\r\n')).toEqual([
      { timeMs: 1_000, text: 'a' },
      { timeMs: 2_000, text: 'b' },
    ]);
  });

  test('strips word-level timing tags', () => {
    expect(parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>world')).toEqual([
      { timeMs: 1_000, text: 'Hello world' },
    ]);
  });

  test('returns an empty list for empty input', () => {
    expect(parseLrc('')).toEqual([]);
  });
});

describe('findActiveLineIndex', () => {
  const lines = [
    { timeMs: 1_000, text: 'a' },
    { timeMs: 2_000, text: 'b' },
    { timeMs: 3_000, text: 'c' },
  ];

  test('returns -1 before the first line', () => {
    expect(findActiveLineIndex(lines, 0)).toBe(-1);
  });

  test('returns the line that started most recently', () => {
    expect(findActiveLineIndex(lines, 1_000)).toBe(0);
    expect(findActiveLineIndex(lines, 2_999)).toBe(1);
    expect(findActiveLineIndex(lines, 99_999)).toBe(2);
  });

  test('returns -1 for no lines', () => {
    expect(findActiveLineIndex([], 500)).toBe(-1);
  });
});
