import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Sends visitors without a session cookie to /sign-in. This only checks that a cookie exists;
 * the API validates it. A stale cookie gets through here and the first API call's 401 sends the
 * user to /sign-in, which this proxy never redirects away from, so there is no loop.
 */
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|sign-in|sign-up|favicon.ico|icon|apple-icon|manifest).*)'],
};
