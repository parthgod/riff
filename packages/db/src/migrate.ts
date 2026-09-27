import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Runs under plain `node` (type stripping), so this file imports packages only, no local modules.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));
/** Arbitrary constant: concurrent migrators (parallel test runs, two deploys) queue on it. */
const MIGRATION_LOCK = 7_241_731;

/** Applies pending migrations. Use a direct (non-pooled) URL: the lock is session-scoped. */
export async function migrateDatabase(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`select pg_advisory_lock(${MIGRATION_LOCK})`;
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  await migrateDatabase(url);
  console.log('Migrations applied');
}
