import { describe, expect, test } from 'vitest';
import { testDatabaseUrl } from './testing';

describe('testDatabaseUrl', () => {
  test('accepts a database whose name ends in _test', () => {
    const url = 'postgres://riff:riff@localhost:5432/riff_test';
    expect(testDatabaseUrl({ DATABASE_URL_TEST: url })).toBe(url);
  });

  test('refuses any other database, so tests never truncate real data', () => {
    expect(() =>
      testDatabaseUrl({ DATABASE_URL_TEST: 'postgres://riff:riff@localhost:5432/riff' }),
    ).toThrow(/must end in _test/);
  });

  test('explains a missing variable', () => {
    expect(() => testDatabaseUrl({})).toThrow(/DATABASE_URL_TEST is not set/);
  });
});
