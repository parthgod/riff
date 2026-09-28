import { migrateTestDatabase } from '@riff/db/testing';

/** Brings riff_test up to date before the server under test starts using it. */
export default async function globalSetup() {
  await migrateTestDatabase();
}
