import { createAuthClient } from 'better-auth/react';

/** Better Auth's browser client; the server half is mounted at /api/auth by @riff/api. */
export const authClient = createAuthClient({ basePath: '/api/auth' });
