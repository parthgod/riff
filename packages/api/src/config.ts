import { type CatalogConfig, catalogConfigFromEnv, createCatalog } from '@riff/catalog';
import { createDb } from '@riff/db';
import { z } from 'zod';
import { createApp } from './app';
import { createAuth } from './auth';

export interface ApiConfig {
  databaseUrl: string;
  authSecret: string;
  authUrl: string;
  allowSignups: boolean;
  catalog: CatalogConfig;
}

type Env = Readonly<Record<string, string | undefined>>;

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  ALLOW_SIGNUPS: z.enum(['true', 'false']).default('true'),
});

/** Reads and validates the API's env vars. Errors name the variables, never their values. */
export function apiConfigFromEnv(env: Env): ApiConfig {
  // Blank values (`ALLOW_SIGNUPS=`) count as unset.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new Error(`Invalid API environment: ${problems.join('; ')}`);
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    authSecret: parsed.data.BETTER_AUTH_SECRET,
    authUrl: parsed.data.BETTER_AUTH_URL,
    allowSignups: parsed.data.ALLOW_SIGNUPS === 'true',
    catalog: catalogConfigFromEnv(env),
  };
}

/** Wires db, catalog and auth from env vars. Call once per process (module scope in Next.js). */
export function createApiFromEnv(env: Env) {
  const config = apiConfigFromEnv(env);
  const { db, close } = createDb(config.databaseUrl);
  const catalog = createCatalog(config.catalog);
  const auth = createAuth({
    db,
    secret: config.authSecret,
    baseURL: config.authUrl,
    allowSignups: config.allowSignups,
  });
  return { app: createApp({ db, catalog, auth }), auth, close };
}
