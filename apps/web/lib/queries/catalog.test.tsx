import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiError, stubApi } from '@/test/api-stub';
import { queryWrapper } from '@/test/query-wrapper';
import { searchText, useLyrics, useSearch, useTrending } from './catalog';

afterEach(() => vi.unstubAllGlobals());

describe('useSearch', () => {
  test('never sends a blank query', () => {
    const { requests } = stubApi({});
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useSearch('   '), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(requests).toEqual([]);
  });

  test('sends the trimmed, collapsed query', async () => {
    const { requests } = stubApi({
      'GET /api/search': { tracks: [], artists: [], collections: [], stations: [], sources: {} },
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useSearch('  lofi   beats '), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests[0]?.query.get('q')).toBe('lofi beats');
    expect(searchText(' a  b ')).toBe('a b');
  });
});

test('useTrending omits the genre for all genres', async () => {
  const { requests } = stubApi({ 'GET /api/trending': { tracks: [], sources: {} } });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(() => useTrending(null, 'month'), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(requests[0]?.query.has('genre')).toBe(false);
  expect(requests[0]?.query.get('window')).toBe('month');
});

describe('useLyrics', () => {
  test('a 404 means no lyrics, not an error', async () => {
    stubApi({ 'GET /api/tracks/audius:t1/lyrics': () => apiError(404, 'NOT_FOUND') });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useLyrics('audius:t1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  test('other failures are errors', async () => {
    stubApi({ 'GET /api/tracks/audius:t1/lyrics': () => apiError(504, 'UPSTREAM_TIMEOUT') });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useLyrics('audius:t1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  test('does nothing without a track', () => {
    const { requests } = stubApi({});
    const { wrapper } = queryWrapper();
    renderHook(() => useLyrics(null), { wrapper });
    expect(requests).toEqual([]);
  });
});
