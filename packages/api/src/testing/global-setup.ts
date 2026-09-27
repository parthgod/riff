import { migrateTestDatabase } from '@riff/db/testing';

/** Vitest globalSetup: bring riff_test up to date once per run. */
export default async function setup(): Promise<void> {
  await migrateTestDatabase();
}
