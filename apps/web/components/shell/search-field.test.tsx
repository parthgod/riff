import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, SearchField } from './search-field';

const nav = vi.hoisted(() => ({
  pathname: '/',
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.params,
}));

beforeEach(() => {
  vi.useFakeTimers();
  nav.pathname = '/';
  nav.params = new URLSearchParams();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const type = (text: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: text } });

describe('SearchField', () => {
  test('from another page, a pause in typing opens the search page', () => {
    render(<SearchField />);
    type('lofi');
    type('lofi beats');
    expect(nav.router.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(nav.router.push).toHaveBeenCalledOnce();
    expect(nav.router.push).toHaveBeenCalledWith('/search?q=lofi%20beats');
  });

  test('on the search page, it replaces the URL instead of stacking history', () => {
    nav.pathname = '/search';
    nav.params = new URLSearchParams('q=lo');
    render(<SearchField />);
    expect(screen.getByRole('searchbox')).toHaveValue('lo');
    type('');
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(nav.router.replace).toHaveBeenCalledWith('/search', { scroll: false });
  });

  test('Enter searches at once', () => {
    render(<SearchField />);
    type('ambient');
    fireEvent.submit(screen.getByRole('searchbox').closest('form') as HTMLFormElement);
    expect(nav.router.push).toHaveBeenCalledWith('/search?q=ambient');
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(nav.router.push).toHaveBeenCalledOnce();
  });
});
