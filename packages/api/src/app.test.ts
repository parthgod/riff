import { describe, expect, test } from 'vitest';
import { setupApi } from './testing/harness';

const api = setupApi();

describe('public routes', () => {
  test('GET /health needs no session', async () => {
    const res = await api.anonymous.get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('sign-up issues an httpOnly session cookie that /me accepts', async () => {
    const alice = await api.signUp('alice');
    expect(alice.cookie).toMatch(/session_token=/);

    const res = await alice.get('/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: alice.id,
      name: 'alice',
      email: 'alice@example.com',
      image: null,
    });
  });
});

describe('auth guard', () => {
  test('every non-public route answers 401 without a session', async () => {
    const routes = api.app.routes.filter(
      (route) =>
        route.method !== 'ALL' &&
        !route.path.includes('*') &&
        route.path !== '/api/health' &&
        !route.path.startsWith('/api/auth/'),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const path = route.path
        .replace(/^\/api/, '')
        .replace(/:(\w+)/g, (_, name: string) =>
          /id$/i.test(name) && !/track|artist/i.test(name)
            ? '00000000-0000-4000-8000-000000000000'
            : 'audius:x',
        );
      const res = await api.anonymous[route.method.toLowerCase() as 'get'](path);
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Sign in to continue' },
      });
    }
  });

  test('a signed-out cookie no longer works', async () => {
    const alice = await api.signUp('alice');
    await alice.post('/auth/sign-out');
    expect((await alice.get('/me')).status).toBe(401);
  });
});

describe('error contract', () => {
  test('unknown routes return the JSON error body', async () => {
    const alice = await api.signUp('alice');
    const res = await alice.get('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No such route' } });
  });

  test('responses are not cacheable unless a route opts in', async () => {
    const alice = await api.signUp('alice');
    expect((await alice.get('/me')).headers.get('cache-control')).toBe('no-store');
    expect((await alice.get('/nope')).headers.get('cache-control')).toBe('no-store');
  });
});

describe('ALLOW_SIGNUPS=false', () => {
  const closed = setupApi({ allowSignups: false });

  test('rejects new accounts', async () => {
    await expect(closed.signUp('mallory')).rejects.toThrow(/EMAIL_PASSWORD_SIGN_UP_DISABLED/);
  });
});
