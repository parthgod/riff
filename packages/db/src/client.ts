import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export interface DbOptions {
  /** Pool size. Serverless functions want a small pool; Neon's pooler does the rest. */
  max?: number;
}

export function createDb(url: string, { max = 5 }: DbOptions = {}) {
  // prepare: false keeps one config valid for Neon's pooled (PgBouncer) URL.
  const client = postgres(url, { max, prepare: false, idle_timeout: 20, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>['db'];
