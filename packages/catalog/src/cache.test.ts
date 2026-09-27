import { describe, expect, test, vi } from 'vitest';
import { createMemoryCache } from './cache';

function clock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('createMemoryCache', () => {
  test('keeps values until their ttl expires', () => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now });
    cache.set('k', 'v', 1_000);
    expect(cache.get('k')).toBe('v');
    c.advance(999);
    expect(cache.get('k')).toBe('v');
    c.advance(1);
    expect(cache.get('k')).toBeUndefined();
  });

  test('evicts the least recently used entry', () => {
    const cache = createMemoryCache({ maxEntries: 2 });
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.get('a');
    cache.set('c', 3, 60_000);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  test('getOrSet runs the loader once for concurrent callers and then serves the cache', async () => {
    const cache = createMemoryCache();
    const loader = vi.fn(async () => 'value');
    const results = await Promise.all([
      cache.getOrSet('k', 1_000, loader),
      cache.getOrSet('k', 1_000, loader),
    ]);
    expect(results).toEqual(['value', 'value']);
    await cache.getOrSet('k', 1_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('getOrSet does not cache rejections', async () => {
    const cache = createMemoryCache();
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(cache.getOrSet('k', 1_000, failing)).rejects.toThrow('boom');
    await expect(cache.getOrSet('k', 1_000, async () => 'ok')).resolves.toBe('ok');
  });

  test('getOrSet derives the ttl from the loaded value', async () => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now });
    await cache.getOrSet(
      'miss',
      (value: string | null) => (value ? 10_000 : 100),
      async () => null,
    );
    expect(cache.get('miss')).toBeNull();
    c.advance(100);
    expect(cache.get('miss')).toBeUndefined();
  });
});
