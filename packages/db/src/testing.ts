import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { createDb } from './client';
import { migrateDatabase } from './migrate';
import {
  account,
  followedArtists,
  likedTracks,
  playHistory,
  playlists,
  playlistTracks,
  session,
  tracks,
  user,
  verification,
} from './schema';

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));
const ALL_TABLES = [
  followedArtists,
  playHistory,
  playlistTracks,
  playlists,
  likedTracks,
  tracks,
  verification,
  account,
  session,
  user,
];

/** DATABASE_URL_TEST from the environment or the root .env; refuses non-`_test` databases. */
export function testDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (!env.DATABASE_URL_TEST && env === process.env) {
    try {
      process.loadEnvFile(ROOT_ENV);
    } catch {
      // No .env file: fall through to the error below.
    }
  }
  const url = env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set (see .env.example)');
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${name}": the name must end in _test`);
  }
  return url;
}

/** Migrates the test database (idempotent, safe to call from parallel processes). */
export async function migrateTestDatabase(): Promise<void> {
  await migrateDatabase(testDatabaseUrl());
}

export function createTestDb() {
  return createDb(testDatabaseUrl(), { max: 2 });
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE ${sql.join(ALL_TABLES, sql`, `)} RESTART IDENTITY CASCADE`);
}
