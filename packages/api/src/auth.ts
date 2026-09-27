import { type Db, schema } from '@riff/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createMiddleware } from 'hono/factory';
import { ApiError } from './errors';

export interface AuthOptions {
  db: Db;
  /** 32+ random characters (BETTER_AUTH_SECRET). */
  secret: string;
  /** Public origin of the app, e.g. http://localhost:3000 (BETTER_AUTH_URL). */
  baseURL: string;
  /** false once the owner's account exists (ALLOW_SIGNUPS). */
  allowSignups: boolean;
}

export function createAuth({ db, secret, baseURL, allowSignups }: AuthOptions) {
  return betterAuth({
    appName: 'Riff',
    basePath: '/api/auth',
    baseURL,
    secret,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true, disableSignUp: !allowSignups },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth['$Infer']['Session']['user'];

export interface AppEnv {
  Variables: { user: SessionUser };
}

/** Rejects requests without a valid session cookie; exposes the user as `c.get('user')`. */
export const requireUser = (auth: Auth) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new ApiError('UNAUTHORIZED', 'Sign in to continue');
    c.set('user', session.user);
    await next();
  });
