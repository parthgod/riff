import { Hono } from 'hono';
import type { AppEnv } from '../auth';

export function meRoutes() {
  return new Hono<AppEnv>().get('/me', (c) => {
    const user = c.get('user');
    return c.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image ?? null,
      createdAt: user.createdAt.toISOString(),
    });
  });
}
