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
  /** Origins besides `baseURL` allowed to make cookie-bearing auth requests. */
  trustedOrigins?: string[];
}

export function createAuth({ db, secret, baseURL, allowSignups, trustedOrigins }: AuthOptions) {
  return betterAuth({
    appName: 'Riff',
    basePath: '/api/auth',
    baseURL,
    secret,
    trustedOrigins,
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
    // Better Auth renews a session at most once a day and sets a fresh cookie when it does;
    // forward that cookie, or the browser's copy expires while the DB session lives on.
    const { headers, response: session } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (!session) throw new ApiError('UNAUTHORIZED', 'Sign in to continue');
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    c.set('user', session.user);
    await next();
  });
