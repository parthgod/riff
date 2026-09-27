import { defineConfig } from 'drizzle-kit';

// `generate` diffs the schema against migrations/meta and needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});
