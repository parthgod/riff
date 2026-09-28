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
  /** Extra origins allowed to make cookie-bearing auth requests (Vercel preview URLs). */
  trustedOrigins: string[];
  catalog: CatalogConfig;
}

type Env = Readonly<Record<string, string | undefined>>;

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  ALLOW_SIGNUPS: z.enum(['true', 'false']).default('true'),
  // Set by Vercel on every deployment: its own hostname and its branch alias (no scheme).
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
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
    // A preview's URL never matches BETTER_AUTH_URL, so trust the preview's own hostnames.
    trustedOrigins: [parsed.data.VERCEL_URL, parsed.data.VERCEL_BRANCH_URL]
      .filter((host): host is string => Boolean(host))
      .map((host) => `https://${host}`),
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
    trustedOrigins: config.trustedOrigins,
  });
  return { app: createApp({ db, catalog, auth }), auth, close };
}
