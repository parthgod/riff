import { describe, expect, test } from 'vitest';
import { apiConfigFromEnv, createApiFromEnv } from './config';

const env = {
  DATABASE_URL: 'postgres://riff:riff@localhost:5432/riff',
  BETTER_AUTH_SECRET: 's'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
};

describe('apiConfigFromEnv', () => {
  test('reads the env with sign-ups allowed by default', () => {
    expect(apiConfigFromEnv(env)).toMatchObject({
      databaseUrl: env.DATABASE_URL,
      authUrl: 'http://localhost:3000',
      allowSignups: true,
      catalog: { jamendo: null },
    });
  });

  test('ALLOW_SIGNUPS=false closes sign-ups; blank means the default', () => {
    expect(apiConfigFromEnv({ ...env, ALLOW_SIGNUPS: 'false' }).allowSignups).toBe(false);
    expect(apiConfigFromEnv({ ...env, ALLOW_SIGNUPS: '' }).allowSignups).toBe(true);
  });

  test('names every problem without echoing secrets', () => {
    const attempt = () =>
      apiConfigFromEnv({ BETTER_AUTH_SECRET: 'replace-me', BETTER_AUTH_URL: 'not a url' });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).toThrow(/BETTER_AUTH_SECRET must be at least 32 characters/);
    expect(attempt).toThrow(/BETTER_AUTH_URL/);
    expect(attempt).not.toThrow(/replace-me/);
  });

  test('rejects ALLOW_SIGNUPS values other than true/false', () => {
    expect(() => apiConfigFromEnv({ ...env, ALLOW_SIGNUPS: 'no' })).toThrow(/ALLOW_SIGNUPS/);
  });
});

test('createApiFromEnv builds a working app without touching the database', async () => {
  const { app, close } = createApiFromEnv(env);
  const res = await app.request('/api/health');
  expect(await res.json()).toEqual({ ok: true });
  await close();
});

describe('trusted origins (Vercel previews)', () => {
  test('trusts the deployment and branch URLs that Vercel sets', () => {
    const preview = {
      ...env,
      VERCEL_URL: 'riff-abc123.vercel.app',
      VERCEL_BRANCH_URL: 'riff-git-feat.vercel.app',
    };
    expect(apiConfigFromEnv(preview).trustedOrigins).toEqual([
      'https://riff-abc123.vercel.app',
      'https://riff-git-feat.vercel.app',
    ]);
    expect(apiConfigFromEnv(env).trustedOrigins).toEqual([]);
  });

  test('Better Auth trusts them next to the app URL', async () => {
    // Better Auth skips origin checks under NODE_ENV=test, so this checks its resolved
    // configuration; the check itself runs in dev and production.
    const { auth, close } = createApiFromEnv({
      ...env,
      VERCEL_BRANCH_URL: 'riff-git-feat.vercel.app',
    });
    const context = await auth.$context;
    expect(context.trustedOrigins).toEqual(
      expect.arrayContaining(['http://localhost:3000', 'https://riff-git-feat.vercel.app']),
    );
    expect(context.trustedOrigins).not.toContain('https://evil.example');
    await close();
  });
});
