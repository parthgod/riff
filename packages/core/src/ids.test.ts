import { describe, expect, test } from 'vitest';
import { isEntityId, makeEntityId, parseEntityId } from './ids';

describe('makeEntityId', () => {
  test('prefixes the native id with its source', () => {
    expect(makeEntityId('audius', 'NQwXON0')).toBe('audius:NQwXON0');
  });

  test('accepts numeric native ids', () => {
    expect(makeEntityId('jamendo', 1234)).toBe('jamendo:1234');
  });

  test('rejects empty native ids', () => {
    expect(() => makeEntityId('audius', '')).toThrow();
  });
});

describe('parseEntityId', () => {
  test('splits on the first colon only', () => {
    expect(parseEntityId('jamendo:album:42')).toEqual({ source: 'jamendo', nativeId: 'album:42' });
  });

  test('returns null for unknown sources, missing parts, or no colon', () => {
    expect(parseEntityId('spotify:abc')).toBeNull();
    expect(parseEntityId('audius:')).toBeNull();
    expect(parseEntityId(':abc')).toBeNull();
    expect(parseEntityId('abc')).toBeNull();
  });

  test('does not mistake user playlist UUIDs for entity ids', () => {
    expect(parseEntityId('3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f')).toBeNull();
  });
});

describe('isEntityId', () => {
  test('accepts valid ids and rejects others', () => {
    expect(isEntityId('radio:9617a958-0601-11e8-ae97-52543be04c81')).toBe(true);
    expect(isEntityId('nope')).toBe(false);
  });
});
