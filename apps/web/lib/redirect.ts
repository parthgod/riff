const PROBE_ORIGIN = 'http://riff.invalid';

/**
 * Where to go after signing in. Only same-origin paths are allowed, so `?next=` can never send
 * the user to another site; the auth pages themselves fall back to Home.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith('/')) return '/';
  // The URL parser applies the browser's rules: it drops tabs and newlines and reads `\` as `/`.
  const url = new URL(next, PROBE_ORIGIN);
  if (url.origin !== PROBE_ORIGIN) return '/';
  if (url.pathname === '/sign-in' || url.pathname === '/sign-up') return '/';
  return url.pathname + url.search + url.hash;
}

export const signInPath = (next: string): string => `/sign-in?next=${encodeURIComponent(next)}`;
