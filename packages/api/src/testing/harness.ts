import { createTestDb, truncateAll } from '@riff/db/testing';
import { afterAll, beforeEach } from 'vitest';
import { createApp } from '../app';
import { createAuth } from '../auth';
import { createFakeCatalog, type FakeCatalog } from './fake-catalog';

export const TEST_AUTH_URL = 'http://localhost:3000';
const TEST_SECRET = 'riff-test-secret-9c1f4e7a2b8d6035e4f1a7c9';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
  get(path: string): Promise<Response>;
  delete(path: string): Promise<Response>;
  put(path: string, body?: unknown): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  patch(path: string, body?: unknown): Promise<Response>;
}

/**
 * Per-file API harness over the real riff_test database and a fake catalog. Each test starts
 * with empty tables and a fresh app + catalog. Paths passed to the helpers omit the /api prefix.
 */
export function setupApi(options: { allowSignups?: boolean } = {}) {
  const { db, close } = createTestDb();
  let catalog: FakeCatalog;
  let app: ReturnType<typeof createApp>;
  const errors: unknown[] = [];

  beforeEach(async () => {
    await truncateAll(db);
    errors.length = 0;
    catalog = createFakeCatalog();
    const auth = createAuth({
      db,
      secret: TEST_SECRET,
      baseURL: TEST_AUTH_URL,
      allowSignups: options.allowSignups ?? true,
    });
    app = createApp({ db, catalog, auth, onError: (error) => errors.push(error) });
  });
  afterAll(() => close());

  async function send(
    method: Method,
    path: string,
    body?: unknown,
    cookie?: string,
  ): Promise<Response> {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    if (body !== undefined) headers.set('content-type', 'application/json');
    return app.request(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function as(cookie?: string) {
    return {
      get: (path: string) => send('GET', path, undefined, cookie),
      delete: (path: string) => send('DELETE', path, undefined, cookie),
      put: (path: string, body?: unknown) => send('PUT', path, body, cookie),
      post: (path: string, body?: unknown) => send('POST', path, body, cookie),
      patch: (path: string, body?: unknown) => send('PATCH', path, body, cookie),
    };
  }

  return {
    db,
    get app() {
      return app;
    },
    get catalog() {
      return catalog;
    },
    /** Errors reported through `onError` during the current test (500s, failed home sections). */
    errors,
    anonymous: as(),

    /** Signs up through Better Auth and returns request helpers carrying the session cookie. */
    async signUp(name = 'alice'): Promise<TestUser> {
      const email = `${name}@example.com`;
      const res = await send('POST', '/auth/sign-up/email', {
        name,
        email,
        password: 'correct-horse-battery',
      });
      if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
      const { user } = (await res.json()) as { user: { id: string } };
      const cookie = res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      return { id: user.id, email, cookie, ...as(cookie) };
    },
  };
}
