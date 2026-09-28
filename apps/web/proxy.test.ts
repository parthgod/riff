// @vitest-environment node
import { getRedirectUrl, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, test } from 'vitest';
import { config, proxy } from './proxy';

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });

describe('proxy', () => {
  test('sends visitors without a session cookie to /sign-in, remembering the page', () => {
    const response = proxy(request('/search?q=lofi'));
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(
      'http://localhost:3000/sign-in?next=%2Fsearch%3Fq%3Dlofi',
    );
  });

  test('lets requests with a session cookie through (the API still checks it)', () => {
    for (const cookie of [
      'better-auth.session_token=abc.def',
      '__Secure-better-auth.session_token=abc.def',
    ]) {
      expect(getRedirectUrl(proxy(request('/liked', cookie)))).toBeNull();
    }
  });

  test.each(['/', '/liked', '/playlist/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', '/search'])(
    'guards %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );

  test.each(['/sign-in', '/sign-up', '/api/me', '/api/auth/get-session', '/_next/static/x.js'])(
    'skips %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});
