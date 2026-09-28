// @vitest-environment node
import { beforeAll, expect, test, vi } from 'vitest';

let GET: (request: Request) => Response | Promise<Response>;

beforeAll(async () => {
  // Valid config; nothing below needs a database connection.
  vi.stubEnv('DATABASE_URL', 'postgres://riff:riff@localhost:5432/riff_test');
  vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(32));
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  // The first import loads the whole API (Better Auth, Drizzle); give it room on a busy machine.
  ({ GET } = await import('./route'));
}, 30_000);

test('mounts the API at /api', async () => {
  const response = await GET(new Request('http://localhost:3000/api/health'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test('library routes still require a session', async () => {
  const response = await GET(new Request('http://localhost:3000/api/me'));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
});
