# Riff Plan 2 — Backend (db + api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two tested packages:
- `@riff/db`: the Drizzle schema, SQL migrations, a client factory and test-database helpers.
- `@riff/api`: a Hono app with Better Auth sessions, every catalog and library route from spec §6, and a typed `hc` client. It is tested through `app.request()` against a real Postgres database.

**Architecture:**
- `@riff/db` owns the schema and migrations. Both `pnpm db:migrate` (plain `node`) and the Vitest setup apply migrations through one `migrateDatabase(url)`, which holds a Postgres advisory lock.
- `@riff/api` is a runtime-agnostic Hono app: `createApp({ db, catalog, auth })` mounts everything at `/api`.
  - Catalog routes are thin wrappers over `@riff/catalog`.
  - Library routes validate input with zod, snapshot tracks and artists through the catalog on write, and read only from Postgres.
- Route tests run against the `riff_test` database with a fake catalog whose values are deep-frozen.

**Tech Stack:** Plan 1's stack, plus:
- drizzle-orm 0.45.3 and drizzle-kit 0.31.11
- postgres (postgres.js) 3.4.9
- hono 4.13.9 and @hono/zod-validator 0.9.1
- better-auth 1.7.6
- fractional-indexing 4.0.0
- PostgreSQL 16 with `pg_trgm`

**Spec:** `docs/superpowers/specs/2026-09-27-riff-v1-design.md` (§6 API, §7 database, §11 testing, §12 environments). This plan builds on Plan 1 (`docs/superpowers/plans/2026-09-27-riff-plan-1-foundation.md`) and consumes its `@riff/core` and `@riff/catalog` unchanged.

**Verified before writing:** every file below was built and run in a scratch clone of this repo on 2026-09-27, on this machine (Node 24.16, pnpm 12.6.0, Postgres 16.15).
- `pnpm test` passes all 257 tests, including three consecutive runs and runs that start from an empty database.
- `pnpm typecheck`, `pnpm lint` and the live suite are clean.
- Toolchain quirks this plan depends on are noted where they apply.

## Global Constraints

- Plan 1's Global Constraints still apply, except its commit-trailer line (see the last bullet).
- New dependency versions are pinned once in `pnpm-workspace.yaml` under `catalog:`: `drizzle-orm 0.45.3`, `drizzle-kit 0.31.11`, `postgres 3.4.9`, `hono 4.13.9`, `@hono/zod-validator 0.9.1`, `better-auth 1.7.6`, `fractional-indexing 4.0.0`.
- `packages/api` uses Web APIs only: no `node:*` imports and no Next.js imports. `packages/db` is server-only and may use `node:url`.
- The database driver is postgres.js everywhere, with `prepare: false` (Neon's pooled URL needs it).
- Every route except `GET /api/health` and `/api/auth/*` requires a session; without one the response is `401 UNAUTHORIZED`.
- The error body is always `{ error: { code, message } }`. Codes and statuses: `BAD_REQUEST` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `UPSTREAM_ERROR` 502, `UPSTREAM_TIMEOUT` 504, `INTERNAL` 500. A 500 never exposes the underlying error message.
- `Cache-Control`:
  - Catalog GETs: `private, max-age=<server TTL / 2>`, in seconds: search 150, trending 300, entities 1800, lyrics 43200, and 15 for a fan-out result with a failed source.
  - Everything else, including errors and `/stream/*`: `no-store`.
- Catalog results are shared cache objects. The API never mutates a value the catalog returns.
- Library writes fetch metadata through the catalog (snapshots); the client never supplies metadata. Library reads come only from Postgres.
- Tests touch only a database whose name ends in `_test` (`DATABASE_URL_TEST`). Every API test starts from truncated tables.
- Migrations run only through `pnpm db:migrate` or the test setup, never during a build or at app start-up.
- Commit after every task with a conventional commit message and **no `Co-Authored-By` trailer**.

## Review Focus

1. **Playlists with more than about 36 entries.** On a cluster whose default collation is `en_US.UTF-8` (this machine's), fractional keys such as `aZ` and `aa` must still sort in insertion order. Pinned in:
   - Task 1: `orders fractional keys byte-wise…`
   - Task 5: `keeps order across 70 single appends…`
2. **Malformed input on any route**: `limit=ten`, `limit=`, 201-character queries, non-UUID playlist ids, malformed JSON bodies, oversized id arrays. Each must return 400 with the error body. None may return 500 or reach an upstream. Pinned in:
   - Task 3: `rejects %s with 400 and never calls the catalog`
   - Task 5: `malformed JSON is 400, not 500` and `a non-UUID playlist id is 400…`
3. **An upstream outage.** Library reads keep working from the DB, and un-like and unfollow still work. Writes that need a snapshot fail with 502 and store nothing. Home degrades one section at a time. Pinned in:
   - Task 4: `lists newest first… even when the catalog is down` and `an upstream failure is 502 and nothing is stored`
   - Task 5: `playlist reads come from the DB…`
   - Task 6: `unfollow is idempotent and needs no upstream`
   - Task 7: `a failing section comes back empty…`
4. **Another user's data, or no session at all**, including on routes added in later tasks. A foreign private playlist is 404 for reads and writes, with no upstream call. Likes, follows and history are per-user. Every non-public route returns 401 without a session. Pinned in:
   - Task 2: `every non-public route answers 401…`. It enumerates `app.routes`, so later routes are covered automatically.
   - Tasks 4 and 6 (per-user isolation), and Task 5 (`ownership and visibility`)
5. **The same track twice, and likes that share a timestamp.** A duplicate track, in one request or across requests, becomes a distinct playlist entry. Pagination over likes with equal timestamps never skips or repeats. Pinned in:
   - Task 5: `appends in request order, allows duplicates…` and `removes one entry, leaving the duplicate`
   - Task 4: `pages through 120 likes…`

---

## File Structure

```
package.json                          + db:generate, db:migrate scripts
pnpm-workspace.yaml                   + catalog versions; allowBuilds (esbuild, for drizzle-kit)
turbo.json                            + test env DATABASE_URL_TEST; .env as a global dependency
biome.json                            ignore generated packages/db/migrations
.env.example                          comments: _test suffix, secret length, ALLOW_SIGNUPS (Task 8)
README.md                             local setup (Task 8)
CLAUDE.md                             project guide updated for db + api (Task 8)
docs/superpowers/specs/…-design.md    spec text aligned with Plan 1/2 decisions (Task 8)
packages/db/
  package.json, tsconfig.json, vitest.config.ts, drizzle.config.ts
  migrations/                         0000_extensions.sql (hand-written), 0001_init.sql + meta/ (drizzle-kit)
  src/schema/auth.ts                  Better Auth tables (output of `npx auth@1.7.6 generate`)
  src/schema/app.ts                   tracks, liked_tracks, playlists, playlist_tracks, play_history, followed_artists
  src/schema/index.ts
  src/client.ts                       createDb(url) → { db, close }; type Db
  src/migrate.ts                      migrateDatabase(url) + CLI entry (advisory lock)
  src/testing.ts                      testDatabaseUrl, migrateTestDatabase, createTestDb, truncateAll
  src/index.ts
packages/api/
  package.json, tsconfig.json, vitest.config.ts
  src/errors.ts                       ApiError, toApiError, errorBody, notFound
  src/validation.ts                   validate(target, schema), limitParam
  src/auth.ts                         createAuth, requireUser, AppEnv
  src/cache-control.ts                noStoreByDefault, cacheFor, fanOutTtl
  src/deps.ts                         AppDeps, reportError
  src/app.ts                          apiRoutes (→ AppType), createApp
  src/routes/{me,catalog,likes,playlists,following,history,home}.ts
  src/library/{snapshots,likes,playlists,following,history,home}.ts
  src/config.ts                       apiConfigFromEnv, createApiFromEnv (Task 8)
  src/client.ts                       createApiClient = hc<AppType>, exported as "@riff/api/client" (Task 8)
  src/testing/{global-setup,fixtures,fake-catalog,harness}.ts
  src/live.test.ts                    the whole API against real upstreams (LIVE=1 only)
  src/index.ts
```

Routes (`src/routes/*`) own the HTTP concerns: validation, status codes and cache headers. Library modules (`src/library/*`) own the SQL and take `(db, userId, …)`, so other callers can reuse them without Hono.

---

### Task 1: `@riff/db`: schema, migrations and test-database helpers

**Files:**
- Modify: `pnpm-workspace.yaml`, `turbo.json`, `package.json`, `biome.json`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema/auth.ts`, `packages/db/src/schema/app.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/src/testing.ts`, `packages/db/src/index.ts`
- Create (partly generated): `packages/db/migrations/0000_extensions.sql`, `packages/db/migrations/0001_init.sql`, `packages/db/migrations/meta/*`
- Test: `packages/db/src/testing.test.ts`, `packages/db/src/schema.test.ts`

**Interfaces:**
- Consumes: the `Track` and `Artist` types from `@riff/core`.
- Produces (`@riff/db`):
  - Better Auth tables: `user`, `session`, `account`, `verification`.
  - App tables: `tracks`, `likedTracks`, `playlists`, `playlistTracks`, `playHistory`, `followedArtists`.
  - The namespace `schema` (all tables), for Better Auth's Drizzle adapter.
  - `createDb(url: string, { max = 5 }?: DbOptions): { db: Db; close(): Promise<void> }` and `type Db`.
- Produces (`@riff/db/testing`):
  - `testDatabaseUrl(env?)`: returns the URL. It throws unless the database name ends in `_test`, and it loads the root `.env` when `DATABASE_URL_TEST` is unset.
  - `migrateTestDatabase(): Promise<void>`
  - `createTestDb(): { db, close }`
  - `truncateAll(db): Promise<void>`
- Produces (CLI):
  - `pnpm db:migrate` applies migrations to `DATABASE_URL`.
  - `pnpm db:generate` diffs the schema into a new migration.

Column facts that later tasks rely on:
- `tracks.data` holds the `Track` JSON.
- `playlist_tracks.position` is `text COLLATE "C"`.
- App timestamps are `timestamptz(3)`: millisecond precision, so they round-trip through JS `Date`s. The likes cursor compares them.
- `liked_tracks` has PK `(user_id, track_id)` and `followed_artists` has PK `(user_id, artist_id)`.
- `play_history.id` is an identity bigint.

- [ ] **Step 1: Root configuration**

`pnpm-workspace.yaml` pins every Plan 2 version at once. `allowBuilds` is needed because pnpm 12 fails the install with `ERR_PNPM_IGNORED_BUILDS` unless esbuild (a drizzle-kit dependency) may run its postinstall:
```yaml
packages:
  - apps/*
  - packages/*

catalog:
  '@hono/zod-validator': 0.9.1
  '@types/node': 24.19.0
  better-auth: 1.7.6
  drizzle-kit: 0.31.11
  drizzle-orm: 0.45.3
  fractional-indexing: 4.0.0
  hono: 4.13.9
  postgres: 3.4.9
  typescript: 7.0.2
  vitest: 5.0.2
  zod: 4.6.5

# drizzle-kit bundles esbuild, whose postinstall fetches its native binary.
allowBuilds:
  esbuild: true
```

`turbo.json`: Turbo's strict env mode would hide `DATABASE_URL_TEST` from `turbo run test`, and changes to `.env` must invalidate cached test results:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "outputs": [], "env": ["DATABASE_URL_TEST"] },
    "typecheck": { "outputs": [] }
  }
}
```

`package.json`: add two scripts after `format`:
```json
    "db:generate": "pnpm --filter @riff/db generate",
    "db:migrate": "pnpm --filter @riff/db migrate"
```

`biome.json`: leave drizzle-kit's generated files untouched. Change the `files` line to:
```json
  "files": { "ignoreUnknown": true, "includes": ["**", "!packages/db/migrations"] },
```

- [ ] **Step 2: Create the package shell**

`packages/db/package.json`. The `migrate` script runs `src/migrate.ts` with plain Node 24 (type stripping plus `import.meta.main`). `--env-file-if-exists` loads the root `.env` without overriding variables that are already set.
```json
{
  "name": "@riff/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "generate": "drizzle-kit generate",
    "migrate": "node --env-file-if-exists=../../.env src/migrate.ts"
  },
  "dependencies": {
    "@riff/core": "workspace:*",
    "drizzle-orm": "catalog:",
    "postgres": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "drizzle-kit": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "drizzle.config.ts"]
}
```

`packages/db/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

// Test files share one database, so they run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
```

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

// `generate` diffs the schema against migrations/meta and needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});
```

Run: `pnpm install`
Expected: installs drizzle-orm, drizzle-kit and postgres. The esbuild postinstall runs, with no `ERR_PNPM_IGNORED_BUILDS`.

- [ ] **Step 3: Write the failing tests**

`packages/db/src/testing.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { testDatabaseUrl } from './testing';

describe('testDatabaseUrl', () => {
  test('accepts a database whose name ends in _test', () => {
    const url = 'postgres://riff:riff@localhost:5432/riff_test';
    expect(testDatabaseUrl({ DATABASE_URL_TEST: url })).toBe(url);
  });

  test('refuses any other database, so tests never truncate real data', () => {
    expect(() =>
      testDatabaseUrl({ DATABASE_URL_TEST: 'postgres://riff:riff@localhost:5432/riff' }),
    ).toThrow(/must end in _test/);
  });

  test('explains a missing variable', () => {
    expect(() => testDatabaseUrl({})).toThrow(/DATABASE_URL_TEST is not set/);
  });
});
```

`packages/db/src/schema.test.ts`. The cascade and ordering checks run inside a transaction that is always rolled back, so they never disturb the API tests that share `riff_test`:
```ts
import type { Track } from '@riff/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  followedArtists,
  likedTracks,
  playHistory,
  playlists,
  playlistTracks,
  tracks,
  user,
} from './schema';
import { createTestDb, migrateTestDatabase, truncateAll } from './testing';

const { db, close } = createTestDb();

beforeAll(async () => {
  await migrateTestDatabase();
  await truncateAll(db);
});
afterAll(() => close());

const track: Track = {
  id: 'audius:t1',
  source: 'audius',
  title: 'Track 1',
  artists: [{ id: 'audius:a1', name: 'Artist' }],
  durationSec: 180,
  isLive: false,
  artwork: {},
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Runs `body` in a transaction that is always rolled back. */
async function inRollback(body: (tx: Tx) => Promise<void>): Promise<void> {
  const rollback = new Error('rollback');
  await db
    .transaction(async (tx) => {
      await body(tx);
      throw rollback;
    })
    .catch((error: unknown) => {
      if (error !== rollback) throw error;
    });
}

describe('migrations', () => {
  test('are idempotent', async () => {
    await expect(migrateTestDatabase()).resolves.toBeUndefined();
  });

  test('install pg_trgm and the library-search trigram index', async () => {
    const indexes = await db.execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'tracks_search_trgm_idx'`,
    );
    expect(indexes[0]?.indexdef).toContain('gin_trgm_ops');
  });

  test('store playlist positions with byte-wise ("C") collation', async () => {
    const columns = await db.execute<{ collation_name: string | null }>(
      sql`select collation_name from information_schema.columns
          where table_name = 'playlist_tracks' and column_name = 'position'`,
    );
    expect(columns[0]?.collation_name).toBe('C');
  });
});

describe('schema', () => {
  test('deleting a user cascades to their library but keeps track snapshots', async () => {
    await inRollback(async (tx) => {
      await tx.insert(user).values({ id: 'u1', name: 'U', email: 'u1@example.com' });
      await tx.insert(tracks).values({
        id: track.id,
        source: 'audius',
        title: track.title,
        artistName: 'Artist',
        data: track,
      });
      const [playlist] = await tx
        .insert(playlists)
        .values({ ownerId: 'u1', name: 'Mix' })
        .returning();
      await tx.insert(playlistTracks).values({
        playlistId: playlist!.id,
        trackId: track.id,
        position: 'a0',
      });
      await tx.insert(likedTracks).values({ userId: 'u1', trackId: track.id });
      await tx.insert(playHistory).values({ userId: 'u1', trackId: track.id, msPlayed: 30_000 });
      await tx.insert(followedArtists).values({
        userId: 'u1',
        artistId: 'audius:a1',
        data: {
          id: 'audius:a1',
          source: 'audius',
          name: 'Artist',
          avatar: {},
          verified: false,
        },
      });

      await tx.delete(user).where(eq(user.id, 'u1'));

      for (const table of [playlists, playlistTracks, likedTracks, playHistory, followedArtists]) {
        expect(await tx.$count(table)).toBe(0);
      }
      expect(await tx.$count(tracks)).toBe(1);
    });
  });

  test('orders fractional keys byte-wise, unlike the default collation', async () => {
    await inRollback(async (tx) => {
      await tx.insert(user).values({ id: 'u1', name: 'U', email: 'u1@example.com' });
      await tx.insert(tracks).values({
        id: track.id,
        source: 'audius',
        title: track.title,
        artistName: 'Artist',
        data: track,
      });
      const [playlist] = await tx
        .insert(playlists)
        .values({ ownerId: 'u1', name: 'Mix' })
        .returning();
      await tx.insert(playlistTracks).values(
        ['aa', 'aZ', 'a9'].map((position) => ({
          playlistId: playlist!.id,
          trackId: track.id,
          position,
        })),
      );
      const rows = await tx
        .select({ position: playlistTracks.position })
        .from(playlistTracks)
        .orderBy(playlistTracks.position);
      expect(rows.map((row) => row.position)).toEqual(['a9', 'aZ', 'aa']);
    });
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm --filter @riff/db test`
Expected: FAIL, because `./testing` and `./schema` cannot be resolved.

- [ ] **Step 5: Implement the schema**

`packages/db/src/schema/auth.ts` is the verbatim output of `npx auth@1.7.6 generate` (the Better Auth 1.7 CLI) for a Drizzle/pg config with email + password, after `pnpm format`. If a table is missing from the schema passed to the adapter, Better Auth logs a `Drizzle schema mismatch` error at start-up:
```ts
// Generated by `npx auth@1.7.6 generate` (Better Auth 1.7.6, Drizzle adapter, pg).
// Regenerate it when upgrading better-auth, then run `pnpm db:generate`.
import { relations } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
```

`packages/db/src/schema/app.ts`:
```ts
import type { Artist, Track } from '@riff/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Fractional-index keys must sort byte-wise. The cluster default collation (for example
 * en_US.UTF-8) orders "aZ" after "aa", which would scramble playlists past ~36 entries.
 */
const byteOrderedText = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });

/** Millisecond precision, so values round-trip through JS Dates (keyset cursors compare them). */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

const userId = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

/** Catalog snapshots: library reads never depend on an upstream being up. */
export const tracks = pgTable(
  'tracks',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    title: text('title').notNull(),
    artistName: text('artist_name').notNull(),
    data: jsonb('data').$type<Track>().notNull(),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('tracks_search_trgm_idx').using(
      'gin',
      sql`(${t.title} || ' ' || ${t.artistName}) gin_trgm_ops`,
    ),
  ],
);

export const likedTracks = pgTable(
  'liked_tracks',
  {
    userId: userId(),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId] }),
    index('liked_tracks_user_created_idx').on(t.userId, t.createdAt.desc()),
  ],
);

export const playlists = pgTable(
  'playlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    isPublic: boolean('is_public').default(false).notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at').defaultNow().notNull(),
  },
  (t) => [index('playlists_owner_idx').on(t.ownerId)],
);

export const playlistTracks = pgTable(
  'playlist_tracks',
  {
    /** Entry id: the same track may appear several times in one playlist. */
    id: uuid('id').primaryKey().defaultRandom(),
    playlistId: uuid('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    position: byteOrderedText('position').notNull(),
    addedAt: timestamptz('added_at').defaultNow().notNull(),
  },
  (t) => [unique('playlist_tracks_playlist_position_key').on(t.playlistId, t.position)],
);

export const playHistory = pgTable(
  'play_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: userId(),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    playedAt: timestamptz('played_at').defaultNow().notNull(),
    msPlayed: integer('ms_played').notNull(),
    context: text('context'),
  },
  (t) => [index('play_history_user_played_idx').on(t.userId, t.playedAt.desc())],
);

export const followedArtists = pgTable(
  'followed_artists',
  {
    userId: userId(),
    artistId: text('artist_id').notNull(),
    data: jsonb('data').$type<Artist>().notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.artistId] })],
);
```

`packages/db/src/schema/index.ts`:
```ts
export * from './app';
export * from './auth';
```

- [ ] **Step 6: Implement the client, migrator and test helpers**

`packages/db/src/client.ts`:
```ts
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
```

`packages/db/src/migrate.ts`. The advisory lock makes concurrent migrators queue: `turbo run test` starts the db and api suites at the same time, and both migrate `riff_test`. The lock is session-scoped, so production migrations need a direct (non-pooled) connection.
```ts
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
```

`packages/db/src/testing.ts`:
```ts
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
```

`packages/db/src/index.ts`:
```ts
export { createDb, type Db, type DbOptions } from './client';
export * as schema from './schema';
export * from './schema';
```

- [ ] **Step 7: Generate the migrations**

Run: `pnpm --filter @riff/db exec drizzle-kit generate --custom --name=extensions`
Expected: `migrations/0000_extensions.sql` (a placeholder comment) and `migrations/meta/`.

Overwrite the whole of `packages/db/migrations/0000_extensions.sql`. Do not append: the generated placeholder has no trailing newline, so appended SQL lands inside the comment.
```sql
-- pg_trgm backs the library-search trigram index; it is a trusted extension, so the
-- database owner can create it without superuser rights.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Run: `pnpm --filter @riff/db exec drizzle-kit generate --name=init`
Expected: it lists 10 tables and writes `migrations/0001_init.sql`. Check that the file contains:
- `"position" text COLLATE "C" NOT NULL`
- `timestamp (3) with time zone`
- `CREATE INDEX "tracks_search_trgm_idx" ON "tracks" USING gin (("title" || ' ' || "artist_name") gin_trgm_ops);`

Run: `pnpm db:generate`
Expected: `No schema changes, nothing to migrate`. This confirms the custom column type round-trips.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @riff/db test && pnpm --filter @riff/db typecheck`
Expected: PASS (8 tests) and a clean typecheck. The first run migrates `riff_test`.

- [ ] **Step 9: Migrate the local dev database**

Run: `pnpm db:migrate && pnpm db:migrate`
Expected: `Migrations applied` twice; the second run applies nothing.

- [ ] **Step 10: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add pnpm-workspace.yaml turbo.json package.json biome.json pnpm-lock.yaml packages/db
git commit -m "feat(db): add Drizzle schema, migrations and test-database helpers"
```

---

### Task 2: `@riff/api`: app shell, auth, session guard and error contract

**Files:**
- Create: `packages/api/package.json`, `packages/api/tsconfig.json`, `packages/api/vitest.config.ts`
- Create: `packages/api/src/errors.ts`, `src/validation.ts`, `src/auth.ts`, `src/cache-control.ts`, `src/deps.ts`, `src/app.ts`, `src/routes/me.ts`, `src/index.ts`
- Create (test kit): `packages/api/src/testing/global-setup.ts`, `src/testing/fixtures.ts`, `src/testing/fake-catalog.ts`, `src/testing/harness.ts`
- Test: `packages/api/src/errors.test.ts`, `packages/api/src/app.test.ts`

**Interfaces:**
- Consumes:
  - From Task 1: `createDb`, `Db`, `schema`, and from `@riff/db/testing`: `createTestDb`, `truncateAll`, `migrateTestDatabase`.
  - From Plan 1: `Catalog`, `CatalogError`, `isCatalogError`, `CACHE_TTL` and `SourceStatuses` from `@riff/catalog`; `Track` and `Artist` from `@riff/core`.
- Produces:
  - `createApp(deps: AppDeps)`: a Hono app mounted at `/api`.
  - `apiRoutes(deps)` and `type AppType = ReturnType<typeof apiRoutes>`. The route tree is relative to `/api`, so the web app can call `hc<AppType>('/api')` (spec §3).
  - `interface AppDeps { db: Db; catalog: Catalog; auth: Auth; onError?(error: unknown, context: string): void }` and `reportError(deps, error, context)`, which defaults to `console.error`.
  - `createAuth({ db, secret, baseURL, allowSignups }): Auth`, `requireUser(auth)` middleware, and `interface AppEnv { Variables: { user: SessionUser } }`.
  - `class ApiError(code: ErrorCode, message)` with `.status`; `notFound(message)`; `toApiError(error: unknown): ApiError`; `errorBody(error): ErrorBody`; and `ERROR_STATUS`.
  - `validate(target, schema)`: a zValidator whose failures throw `ApiError('BAD_REQUEST', '<path>: <zod message>')`. Also `limitParam(max, fallback)` for `?limit=`.
  - The `noStoreByDefault` middleware, `cacheFor(c, ttlMs)` and `fanOutTtl(sources, ttlMs)`.
  - Routes: `GET /api/health` returns `{ ok: true }`. `GET /api/me` returns `{ id, name, email, image: string | null, createdAt }`.
  - Test kit:
    - `setupApi({ allowSignups? })` returns `{ db, app, catalog, errors, anonymous, signUp(name?) }`, where `signUp` resolves to a `TestUser`.
    - `TestUser` has `id`, `email` and `cookie`, plus `get(path)`, `delete(path)`, `put(path, body?)`, `post(path, body?)` and `patch(path, body?)`. Paths omit `/api`.
    - `createFakeCatalog()`: every `Catalog` method is a `vi.fn`, and stored values are deep-frozen. Setup helpers: `addTracks`, `addArtists`, `setArtistTracks`, `addCollection`, `setLyrics`.
    - `okSources`.
    - `makeTrack(n, overrides?)`: id `audius:t<n>`, artist `audius:a1` "Artist 1", artwork `https://img.example/t<n>/{150,480}.jpg`.
    - `makeArtist(n, overrides?)`: id `audius:a<n>`.

Behaviour this task relies on (all verified):
- **Origin check.** Outside `NODE_ENV=test`, Better Auth enforces an Origin check on cookie-bearing POSTs: a foreign Origin gets 403 `INVALID_ORIGIN`. Vitest sets `NODE_ENV=test`, so test requests need no Origin header. In the browser the session cookie is `HttpOnly; SameSite=Lax`, and no GET route changes state.
- **Closed sign-ups.** When `disableSignUp` is set, Better Auth answers `400 { "code": "EMAIL_PASSWORD_SIGN_UP_DISABLED", … }` in its own format. Riff's error contract covers only Riff's routes.
- **Handler order.** Hono runs matching handlers in registration order. `/health` and `/auth/*` come before the `requireUser` middleware, so they stay public. Everything registered after the guard is protected, including unknown paths, which get 401 before 404.
- **Error propagation.** Sub-apps mounted with `.route()` have no `onError`, so their errors reach the outer app's `onError`.

- [ ] **Step 1: Create the package shell**

`packages/api/package.json`. It lists `fractional-indexing` now, although Task 5 is the first to use it:
```json
{
  "name": "@riff/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:live": "LIVE=1 vitest run src/live.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/zod-validator": "catalog:",
    "@riff/catalog": "workspace:*",
    "@riff/core": "workspace:*",
    "@riff/db": "workspace:*",
    "better-auth": "catalog:",
    "drizzle-orm": "catalog:",
    "fractional-indexing": "catalog:",
    "hono": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test file truncates the shared riff_test database, so files run one at a time.
    fileParallelism: false,
    globalSetup: ['./src/testing/global-setup.ts'],
  },
});
```

Run: `pnpm install`
Expected: links `@riff/core`, `@riff/catalog` and `@riff/db`, and installs hono, better-auth and the other dependencies.

- [ ] **Step 2: Add the test kit**

These files are test support, not tests. `harness.ts` imports `../app` and `../auth`, which Step 5 creates.

`packages/api/src/testing/global-setup.ts`:
```ts
import { migrateTestDatabase } from '@riff/db/testing';

/** Vitest globalSetup: bring riff_test up to date once per run. */
export default async function setup(): Promise<void> {
  await migrateTestDatabase();
}
```

`packages/api/src/testing/fixtures.ts`:
```ts
import type { Artist, Track } from '@riff/core';

export function makeTrack(n: number | string, overrides: Partial<Track> = {}): Track {
  return {
    id: `audius:t${n}`,
    source: 'audius',
    title: `Track ${n}`,
    artists: [{ id: 'audius:a1', name: 'Artist 1' }],
    durationSec: 180,
    isLive: false,
    artwork: { sm: `https://img.example/t${n}/150.jpg`, md: `https://img.example/t${n}/480.jpg` },
    ...overrides,
  };
}

export function makeArtist(n: number | string, overrides: Partial<Artist> = {}): Artist {
  return {
    id: `audius:a${n}`,
    source: 'audius',
    name: `Artist ${n}`,
    avatar: {},
    verified: false,
    ...overrides,
  };
}
```

`packages/api/src/testing/fake-catalog.ts`:
```ts
import { type Catalog, CatalogError, type SourceStatuses } from '@riff/catalog';
import type { Artist, Collection, Lyrics, Track } from '@riff/core';
import { vi } from 'vitest';

export const okSources: SourceStatuses = { audius: 'ok', jamendo: 'disabled', radio: 'ok' };

/**
 * In-memory Catalog for route tests. Every method is a vi.fn (override per test with
 * mockResolvedValueOnce / mockRejectedValueOnce). Stored values are deep-frozen, like the real
 * catalog's shared cache entries, so any mutation by the API throws.
 */
export function createFakeCatalog() {
  const tracks = new Map<string, Track>();
  const artists = new Map<string, Artist>();
  const artistTracks = new Map<string, Track[]>();
  const collections = new Map<string, Collection>();
  const lyrics = new Map<string, Lyrics>();
  const missing = (id: string) => new CatalogError('NOT_FOUND', `Nothing found for ${id}`);
  const lookup = <T>(map: Map<string, T>, id: string): T => {
    const value = map.get(id);
    if (value === undefined) throw missing(id);
    return value;
  };

  return {
    addTracks(...list: Track[]) {
      for (const track of list) tracks.set(track.id, deepFreeze(track));
    },
    addArtists(...list: Artist[]) {
      for (const artist of list) artists.set(artist.id, deepFreeze(artist));
    },
    setArtistTracks(artistId: string, list: Track[]) {
      artistTracks.set(artistId, deepFreeze(list));
    },
    addCollection(collection: Collection) {
      collections.set(collection.id, deepFreeze(collection));
    },
    setLyrics(trackId: string, value: Lyrics) {
      lyrics.set(trackId, deepFreeze(value));
    },

    search: vi.fn<Catalog['search']>(async () =>
      deepFreeze({ tracks: [], artists: [], collections: [], stations: [], sources: okSources }),
    ),
    trending: vi.fn<Catalog['trending']>(async () =>
      deepFreeze({ tracks: [], sources: okSources }),
    ),
    getTrack: vi.fn<Catalog['getTrack']>(async (id) => lookup(tracks, id)),
    getArtist: vi.fn<Catalog['getArtist']>(async (id) => lookup(artists, id)),
    getArtistTracks: vi.fn<Catalog['getArtistTracks']>(async (id, { limit }) =>
      (artistTracks.get(id) ?? []).slice(0, limit),
    ),
    getRelatedArtists: vi.fn<Catalog['getRelatedArtists']>(async () => []),
    getCollection: vi.fn<Catalog['getCollection']>(async (id) => lookup(collections, id)),
    resolveStream: vi.fn<Catalog['resolveStream']>(async (id) => {
      lookup(tracks, id);
      return { url: `https://cdn.example/${id}.mp3`, mirrors: [], live: false };
    }),
    getLyrics: vi.fn<Catalog['getLyrics']>(async (id) => {
      lookup(tracks, id);
      return lyrics.get(id) ?? null;
    }),
    radioTop: vi.fn<Catalog['radioTop']>(async () => []),
    radioSearch: vi.fn<Catalog['radioSearch']>(async () => []),
  } satisfies Catalog & Record<string, unknown>;
}

export type FakeCatalog = ReturnType<typeof createFakeCatalog>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
```

`packages/api/src/testing/harness.ts`:
```ts
import { createTestDb, truncateAll } from '@riff/db/testing';
import { afterAll, beforeEach } from 'vitest';
import { createApp } from '../app';
import { createAuth } from '../auth';
import { createFakeCatalog, type FakeCatalog } from './fake-catalog';

export const TEST_AUTH_URL = 'http://localhost:3000';
const TEST_SECRET = 'riff-test-secret-9c1f4e7a2b8d6035e4f1a7c9';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
  get(path: string): Promise<Response>;
  delete(path: string): Promise<Response>;
  put(path: string, body?: unknown): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  patch(path: string, body?: unknown): Promise<Response>;
}

/**
 * Per-file API harness over the real riff_test database and a fake catalog. Each test starts
 * with empty tables and a fresh app + catalog. Paths passed to the helpers omit the /api prefix.
 */
export function setupApi(options: { allowSignups?: boolean } = {}) {
  const { db, close } = createTestDb();
  let catalog: FakeCatalog;
  let app: ReturnType<typeof createApp>;
  const errors: unknown[] = [];

  beforeEach(async () => {
    await truncateAll(db);
    errors.length = 0;
    catalog = createFakeCatalog();
    const auth = createAuth({
      db,
      secret: TEST_SECRET,
      baseURL: TEST_AUTH_URL,
      allowSignups: options.allowSignups ?? true,
    });
    app = createApp({ db, catalog, auth, onError: (error) => errors.push(error) });
  });
  afterAll(() => close());

  async function send(
    method: Method,
    path: string,
    body?: unknown,
    cookie?: string,
  ): Promise<Response> {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    if (body !== undefined) headers.set('content-type', 'application/json');
    return app.request(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function as(cookie?: string) {
    return {
      get: (path: string) => send('GET', path, undefined, cookie),
      delete: (path: string) => send('DELETE', path, undefined, cookie),
      put: (path: string, body?: unknown) => send('PUT', path, body, cookie),
      post: (path: string, body?: unknown) => send('POST', path, body, cookie),
      patch: (path: string, body?: unknown) => send('PATCH', path, body, cookie),
    };
  }

  return {
    db,
    get app() {
      return app;
    },
    get catalog() {
      return catalog;
    },
    /** Errors reported through `onError` during the current test (500s, failed home sections). */
    errors,
    anonymous: as(),

    /** Signs up through Better Auth and returns request helpers carrying the session cookie. */
    async signUp(name = 'alice'): Promise<TestUser> {
      const email = `${name}@example.com`;
      const res = await send('POST', '/auth/sign-up/email', {
        name,
        email,
        password: 'correct-horse-battery',
      });
      if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
      const { user } = (await res.json()) as { user: { id: string } };
      const cookie = res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      return { id: user.id, email, cookie, ...as(cookie) };
    },
  };
}
```

- [ ] **Step 3: Write the failing tests**

`packages/api/src/errors.test.ts`:
```ts
import { CatalogError } from '@riff/catalog';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, test } from 'vitest';
import { ApiError, toApiError } from './errors';

describe('toApiError', () => {
  test.each([
    ['NOT_FOUND', 404],
    ['UPSTREAM_ERROR', 502],
    ['UPSTREAM_TIMEOUT', 504],
  ] as const)('maps CatalogError %s to %i', (code, status) => {
    const error = toApiError(new CatalogError(code, 'upstream said no'));
    expect(error).toMatchObject({ code, status, message: 'upstream said no' });
  });

  test('keeps ApiErrors as they are', () => {
    const original = new ApiError('FORBIDDEN', 'nope');
    expect(toApiError(original)).toBe(original);
  });

  test('maps Hono HTTP exceptions by status', () => {
    expect(toApiError(new HTTPException(400, { message: 'Malformed JSON' }))).toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });
    expect(toApiError(new HTTPException(413))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(toApiError(new HTTPException(503))).toMatchObject({ code: 'INTERNAL', status: 500 });
  });

  test('hides the details of unexpected errors', () => {
    const error = toApiError(new Error('password=hunter2 in a stack trace'));
    expect(error).toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(error.message).not.toContain('hunter2');
  });
});
```

`packages/api/src/app.test.ts`. The guard test walks `app.routes`, so every route added by later tasks is checked automatically. It substitutes a UUID for `:id` and `:entryId` params, and `audius:x` for track, artist and entity ids.
```ts
import { describe, expect, test } from 'vitest';
import { setupApi } from './testing/harness';

const api = setupApi();

describe('public routes', () => {
  test('GET /health needs no session', async () => {
    const res = await api.anonymous.get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('sign-up issues an httpOnly session cookie that /me accepts', async () => {
    const alice = await api.signUp('alice');
    expect(alice.cookie).toMatch(/session_token=/);

    const res = await alice.get('/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: alice.id,
      name: 'alice',
      email: 'alice@example.com',
      image: null,
    });
  });
});

describe('auth guard', () => {
  test('every non-public route answers 401 without a session', async () => {
    const routes = api.app.routes.filter(
      (route) =>
        route.method !== 'ALL' &&
        !route.path.includes('*') &&
        route.path !== '/api/health' &&
        !route.path.startsWith('/api/auth/'),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const path = route.path
        .replace(/^\/api/, '')
        .replace(/:(\w+)/g, (_, name: string) =>
          /id$/i.test(name) && !/track|artist/i.test(name)
            ? '00000000-0000-4000-8000-000000000000'
            : 'audius:x',
        );
      const res = await api.anonymous[route.method.toLowerCase() as 'get'](path);
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
      expect(await res.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Sign in to continue' },
      });
    }
  });

  test('a signed-out cookie no longer works', async () => {
    const alice = await api.signUp('alice');
    await alice.post('/auth/sign-out');
    expect((await alice.get('/me')).status).toBe(401);
  });
});

describe('error contract', () => {
  test('unknown routes return the JSON error body', async () => {
    const alice = await api.signUp('alice');
    const res = await alice.get('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No such route' } });
  });

  test('responses are not cacheable unless a route opts in', async () => {
    const alice = await api.signUp('alice');
    expect((await alice.get('/me')).headers.get('cache-control')).toBe('no-store');
    expect((await alice.get('/nope')).headers.get('cache-control')).toBe('no-store');
  });
});

describe('ALLOW_SIGNUPS=false', () => {
  const closed = setupApi({ allowSignups: false });

  test('rejects new accounts', async () => {
    await expect(closed.signUp('mallory')).rejects.toThrow(/EMAIL_PASSWORD_SIGN_UP_DISABLED/);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm --filter @riff/api test`
Expected: FAIL, because `./errors` and `../app` cannot be resolved.

- [ ] **Step 5: Implement errors, validation and auth**

`packages/api/src/errors.ts`:
```ts
import { isCatalogError } from '@riff/catalog';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }

  get status(): ContentfulStatusCode {
    return ERROR_STATUS[this.code];
  }
}

export const notFound = (message: string) => new ApiError('NOT_FOUND', message);

/** Maps anything thrown by a route (catalog, validation, Hono, bugs) to the API error contract. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isCatalogError(error)) return new ApiError(error.code, error.message);
  if (error instanceof HTTPException)
    return new ApiError(codeForStatus(error.status), error.message);
  return new ApiError('INTERNAL', 'Something went wrong');
}

export function errorBody(error: ApiError): ErrorBody {
  return { error: { code: error.code, message: error.message } };
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'INTERNAL';
}
```

`packages/api/src/validation.ts`. `z.coerce.number<string>()` keeps the typed client's query type as `string`:
```ts
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';
import { ApiError } from './errors';

/** zValidator that reports failures through the API error contract (400 BAD_REQUEST). */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw new ApiError('BAD_REQUEST', describeIssue(result.error.issues[0]));
  });

function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** A `?limit=` query parameter: an integer in [1, max], defaulting to `fallback`. */
export const limitParam = (max: number, fallback: number) =>
  z.coerce.number<string>().int().min(1).max(max).default(fallback);
```

`packages/api/src/auth.ts`:
```ts
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
```

- [ ] **Step 6: Implement caching, deps, the app and `/me`**

`packages/api/src/cache-control.ts`:
```ts
import { CACHE_TTL, type SourceStatuses } from '@riff/catalog';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

/** Default for every response; catalog GETs opt in to caching with `cacheFor`. */
export const noStoreByDefault = createMiddleware(async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

/** Half the server-side TTL; `private` because every catalog route requires a session. */
export function cacheFor(c: Context, ttlMs: number): void {
  c.header('Cache-Control', `private, max-age=${Math.floor(ttlMs / 2000)}`);
}

/** Search and trending results where a source failed are retried soon, on both sides. */
export const fanOutTtl = (sources: SourceStatuses, ttlMs: number): number =>
  Object.values(sources).some((status) => status === 'error' || status === 'timeout')
    ? CACHE_TTL.partial
    : ttlMs;
```

`packages/api/src/deps.ts`:
```ts
import type { Catalog } from '@riff/catalog';
import type { Db } from '@riff/db';
import type { Auth } from './auth';

export interface AppDeps {
  db: Db;
  catalog: Catalog;
  auth: Auth;
  /** Receives failures the API absorbs or hides (500s, failed home sections). Default: console. */
  onError?: (error: unknown, context: string) => void;
}

export function reportError(deps: Pick<AppDeps, 'onError'>, error: unknown, context: string): void {
  if (deps.onError) deps.onError(error, context);
  else console.error(`[api] ${context}`, error);
}
```

`packages/api/src/routes/me.ts`:
```ts
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
```

`packages/api/src/app.ts`. Later tasks append one `.route(...)` line each:
```ts
import { Hono } from 'hono';
import { type AppEnv, requireUser } from './auth';
import { noStoreByDefault } from './cache-control';
import { type AppDeps, reportError } from './deps';
import { ApiError, errorBody, toApiError } from './errors';
import { meRoutes } from './routes/me';

/** Every route, relative to /api. `AppType` (for `hc`) is derived from this. */
export function apiRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .use('*', noStoreByDefault)
    .get('/health', (c) => c.json({ ok: true as const }))
    .on(['GET', 'POST'], '/auth/*', (c) => deps.auth.handler(c.req.raw))
    .use('*', requireUser(deps.auth))
    .route('/', meRoutes());
}

export type AppType = ReturnType<typeof apiRoutes>;

/** The API mounted at /api, with the error contract applied to every route. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath('/api');
  app.onError((error, c) => {
    const apiError = toApiError(error);
    if (apiError.code === 'INTERNAL') reportError(deps, error, `${c.req.method} ${c.req.path}`);
    c.header('Cache-Control', 'no-store');
    return c.json(errorBody(apiError), apiError.status);
  });
  app.notFound((c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(errorBody(new ApiError('NOT_FOUND', 'No such route')), 404);
  });
  app.route('/', apiRoutes(deps));
  return app;
}
```

`packages/api/src/index.ts` (Task 8 extends it):
```ts
export { type AppType, apiRoutes, createApp } from './app';
export { type AppEnv, type Auth, type AuthOptions, createAuth, type SessionUser } from './auth';
export type { AppDeps } from './deps';
export { ApiError, type ErrorBody, type ErrorCode } from './errors';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @riff/api test && pnpm --filter @riff/api typecheck`
Expected: PASS (13 tests) and a clean typecheck.

- [ ] **Step 8: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add packages/api pnpm-lock.yaml
git commit -m "feat(api): add Hono app with Better Auth sessions, a session guard and the error contract"
```

---

### Task 3: Catalog routes

**Files:**
- Create: `packages/api/src/routes/catalog.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/routes/catalog.test.ts`

**Interfaces:**
- Consumes: `validate`, `limitParam`, `cacheFor`, `fanOutTtl`, `ApiError`, `notFound` and `AppEnv` from Task 2. From Plan 1: the `Catalog` methods, `CACHE_TTL`, `GENRES` and `TrendingWindowSchema`.
- Produces `catalogRoutes(catalog: Catalog)` with these routes:

| Route | Query | Calls | `Cache-Control` max-age |
|---|---|---|---|
| `GET /search` | `q` (required, trimmed, ≤ 200 chars), `limit` 1–50, default 20 | `search` | 150, or 15 if partial |
| `GET /trending` | `genre?` (≤ 50), `window` (default `week`), `limit` 1–100, default 30 | `trending` | 300, or 15 if partial |
| `GET /genres` | – | `GENRES` | 1800 |
| `GET /tracks/:id` | – | `getTrack` | 1800 |
| `GET /tracks/:id/lyrics` | – | `getLyrics`; 404 when null | 43200 |
| `GET /stream/:id` | `format=json?` | `resolveStream`; 302 to the URL, or JSON `StreamInfo` | `no-store` |
| `GET /artists/:id` | – | `getArtist` | 1800 |
| `GET /artists/:id/tracks` | `limit` 1–50, default 20 | `getArtistTracks` | 1800 |
| `GET /artists/:id/related` | `limit` 1–50, default 10 | `getRelatedArtists` | 1800 |
| `GET /collections/:id` | – | `getCollection` | 1800 |
| `GET /radio/top` | `tag?`, `limit` 1–100, default 30 | `radioTop` | 300 |
| `GET /radio/search` | `q?`, `tag?`, `limit` | `radioSearch(q)` if `q`, else `radioTop({ tag })`; 400 if neither | 150 / 300 |

Unknown or malformed entity ids come back as `CatalogError NOT_FOUND`, which maps to 404. Entity id params are not validated here; the catalog decides.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routes/catalog.test.ts`:
```ts
import { CatalogError } from '@riff/catalog';
import { GENRES } from '@riff/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { okSources } from '../testing/fake-catalog';
import { makeArtist, makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
});

describe('GET /search', () => {
  test('passes the query and limit to the catalog and returns its result', async () => {
    const res = await alice.get('/search?q=lofi%20beats&limit=5');
    expect(res.status).toBe(200);
    expect(api.catalog.search).toHaveBeenCalledWith('lofi beats', { limit: 5 });
    expect(await res.json()).toEqual({
      tracks: [],
      artists: [],
      collections: [],
      stations: [],
      sources: okSources,
    });
  });

  test('defaults the limit to 20 and keeps Unicode and URL-special characters intact', async () => {
    await alice.get(`/search?q=${encodeURIComponent('AC/DC & Beyoncé')}`);
    expect(api.catalog.search).toHaveBeenCalledWith('AC/DC & Beyoncé', { limit: 20 });
  });

  test('is privately cacheable for half the server TTL (5 min -> 150 s)', async () => {
    const res = await alice.get('/search?q=x');
    expect(res.headers.get('cache-control')).toBe('private, max-age=150');
  });

  test('a partial result (a source failed) is cacheable only briefly', async () => {
    api.catalog.search.mockResolvedValueOnce({
      tracks: [],
      artists: [],
      collections: [],
      stations: [],
      sources: { ...okSources, audius: 'timeout' },
    });
    const res = await alice.get('/search?q=x');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=15');
  });

  test.each([
    ['missing q', '/search'],
    ['limit 0', '/search?q=x&limit=0'],
    ['limit above 50', '/search?q=x&limit=51'],
    ['fractional limit', '/search?q=x&limit=2.5'],
    ['non-numeric limit', '/search?q=x&limit=ten'],
    ['empty limit', '/search?q=x&limit='],
    ['query over 200 characters', `/search?q=${'a'.repeat(201)}`],
  ])('rejects %s with 400 and never calls the catalog', async (_, path) => {
    const res = await alice.get(path);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/^(q|limit): /);
    expect(api.catalog.search).not.toHaveBeenCalled();
  });
});

describe('GET /trending', () => {
  test('defaults to this week and 30 tracks', async () => {
    const res = await alice.get('/trending');
    expect(res.status).toBe(200);
    expect(api.catalog.trending).toHaveBeenCalledWith({ window: 'week', limit: 30 });
    expect(await res.json()).toEqual({ tracks: [], sources: okSources });
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });

  test('passes genre and window through', async () => {
    await alice.get(`/trending?genre=${encodeURIComponent('Hip-Hop/Rap')}&window=allTime&limit=10`);
    expect(api.catalog.trending).toHaveBeenCalledWith({
      genre: 'Hip-Hop/Rap',
      window: 'allTime',
      limit: 10,
    });
  });

  test('rejects an unknown window', async () => {
    expect((await alice.get('/trending?window=year')).status).toBe(400);
  });
});

test('GET /genres returns the genre list', async () => {
  const res = await alice.get('/genres');
  expect(await res.json()).toEqual([...GENRES]);
});

describe('entity routes', () => {
  test('GET /tracks/:id returns the track, with plain or percent-encoded colons', async () => {
    const track = makeTrack(1);
    api.catalog.addTracks(track);
    for (const path of ['/tracks/audius:t1', '/tracks/audius%3At1']) {
      const res = await alice.get(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(track);
      expect(res.headers.get('cache-control')).toBe('private, max-age=1800');
    }
  });

  test('ids with several colons reach the catalog whole', async () => {
    await alice.get('/collections/jamendo:album:42');
    expect(api.catalog.getCollection).toHaveBeenCalledWith('jamendo:album:42');
  });

  test('unknown ids are 404 with the error body and no-store', async () => {
    const res = await alice.get('/tracks/audius:nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Nothing found for audius:nope' },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test.each([
    ['UPSTREAM_ERROR', 502],
    ['UPSTREAM_TIMEOUT', 504],
  ] as const)('an upstream %s becomes %i', async (code, status) => {
    api.catalog.getArtist.mockRejectedValueOnce(new CatalogError(code, 'Audius is down'));
    const res = await alice.get('/artists/audius:a1');
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: { code, message: 'Audius is down' } });
  });

  test('unexpected failures are 500 with a generic message and get reported', async () => {
    api.catalog.getTrack.mockRejectedValueOnce(new TypeError('cannot read x of undefined'));
    const res = await alice.get('/tracks/audius:t1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong' },
    });
    expect(api.errors).toHaveLength(1);
  });

  test('artist tracks and related artists take a bounded limit', async () => {
    api.catalog.addArtists(makeArtist(1));
    api.catalog.setArtistTracks('audius:a1', [makeTrack(1), makeTrack(2), makeTrack(3)]);

    const tracks = await alice.get('/artists/audius:a1/tracks?limit=2');
    expect((await tracks.json()).map((t: { id: string }) => t.id)).toEqual([
      'audius:t1',
      'audius:t2',
    ]);
    await alice.get('/artists/audius:a1/related');
    expect(api.catalog.getRelatedArtists).toHaveBeenCalledWith('audius:a1', { limit: 10 });
    expect((await alice.get('/artists/audius:a1/tracks?limit=500')).status).toBe(400);
  });
});

describe('GET /tracks/:id/lyrics', () => {
  test('returns lyrics when the catalog has them', async () => {
    api.catalog.addTracks(makeTrack(1));
    const lyrics = { synced: [{ timeMs: 0, text: 'hi' }], plain: 'hi', instrumental: false };
    api.catalog.setLyrics('audius:t1', lyrics);
    const res = await alice.get('/tracks/audius:t1/lyrics');
    expect(await res.json()).toEqual(lyrics);
    expect(res.headers.get('cache-control')).toBe('private, max-age=43200');
  });

  test('is 404 when no lyrics exist', async () => {
    api.catalog.addTracks(makeTrack(1));
    const res = await alice.get('/tracks/audius:t1/lyrics');
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe('No lyrics for this track');
  });
});

describe('GET /stream/:id', () => {
  test('redirects to the resolved URL and is never cached', async () => {
    api.catalog.addTracks(makeTrack(1));
    const res = await alice.get('/stream/audius:t1');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cdn.example/audius:t1.mp3');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('?format=json returns the StreamInfo for mirror fallback', async () => {
    api.catalog.addTracks(makeTrack(1));
    const res = await alice.get('/stream/audius:t1?format=json');
    expect(await res.json()).toEqual({
      url: 'https://cdn.example/audius:t1.mp3',
      mirrors: [],
      live: false,
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('rejects other formats', async () => {
    expect((await alice.get('/stream/audius:t1?format=xml')).status).toBe(400);
  });
});

describe('radio', () => {
  test('GET /radio/top passes tag and limit', async () => {
    await alice.get('/radio/top?tag=jazz&limit=5');
    expect(api.catalog.radioTop).toHaveBeenCalledWith({ tag: 'jazz', limit: 5 });
  });

  test('GET /radio/search searches by name, or lists a tag when only a tag is given', async () => {
    await alice.get('/radio/search?q=fip');
    expect(api.catalog.radioSearch).toHaveBeenCalledWith('fip', { limit: 30 });
    await alice.get('/radio/search?tag=ambient');
    expect(api.catalog.radioTop).toHaveBeenCalledWith({ tag: 'ambient', limit: 30 });
  });

  test('GET /radio/search without q or tag is 400', async () => {
    const res = await alice.get('/radio/search?q=%20%20');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Pass q or tag');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @riff/api exec vitest run src/routes/catalog.test.ts`
Expected: FAIL. Every request gets 404 `No such route` (the routes don't exist yet), for example `expected 404 to be 200`.

- [ ] **Step 3: Implement**

`packages/api/src/routes/catalog.ts`:
```ts
import { CACHE_TTL, type Catalog } from '@riff/catalog';
import { GENRES, TrendingWindowSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import { cacheFor, fanOutTtl } from '../cache-control';
import { ApiError, notFound } from '../errors';
import { limitParam, validate } from '../validation';

const queryText = z.string().trim().max(200);
const tag = z.string().trim().min(1).max(50);

export function catalogRoutes(catalog: Catalog) {
  return new Hono<AppEnv>()
    .get(
      '/search',
      validate('query', z.object({ q: queryText, limit: limitParam(50, 20) })),
      async (c) => {
        const { q, limit } = c.req.valid('query');
        const result = await catalog.search(q, { limit });
        cacheFor(c, fanOutTtl(result.sources, CACHE_TTL.search));
        return c.json(result);
      },
    )
    .get(
      '/trending',
      validate(
        'query',
        z.object({
          genre: tag.optional(),
          window: TrendingWindowSchema.default('week'),
          limit: limitParam(100, 30),
        }),
      ),
      async (c) => {
        const result = await catalog.trending(c.req.valid('query'));
        cacheFor(c, fanOutTtl(result.sources, CACHE_TTL.trending));
        return c.json({ tracks: result.tracks, sources: result.sources });
      },
    )
    .get('/genres', (c) => {
      cacheFor(c, CACHE_TTL.entity);
      return c.json(GENRES);
    })
    .get('/tracks/:id', async (c) => {
      const track = await catalog.getTrack(c.req.param('id'));
      cacheFor(c, CACHE_TTL.entity);
      return c.json(track);
    })
    .get('/tracks/:id/lyrics', async (c) => {
      const lyrics = await catalog.getLyrics(c.req.param('id'));
      if (!lyrics) throw notFound('No lyrics for this track');
      cacheFor(c, CACHE_TTL.lyricsFound);
      return c.json(lyrics);
    })
    .get(
      '/stream/:id',
      validate('query', z.object({ format: z.literal('json').optional() })),
      async (c) => {
        // Signed URLs expire, so stream responses stay no-store (the default).
        const stream = await catalog.resolveStream(c.req.param('id'));
        if (c.req.valid('query').format === 'json') return c.json(stream);
        return c.redirect(stream.url, 302);
      },
    )
    .get('/artists/:id', async (c) => {
      const artist = await catalog.getArtist(c.req.param('id'));
      cacheFor(c, CACHE_TTL.entity);
      return c.json(artist);
    })
    .get(
      '/artists/:id/tracks',
      validate('query', z.object({ limit: limitParam(50, 20) })),
      async (c) => {
        const tracks = await catalog.getArtistTracks(c.req.param('id'), c.req.valid('query'));
        cacheFor(c, CACHE_TTL.entity);
        return c.json(tracks);
      },
    )
    .get(
      '/artists/:id/related',
      validate('query', z.object({ limit: limitParam(50, 10) })),
      async (c) => {
        const artists = await catalog.getRelatedArtists(c.req.param('id'), c.req.valid('query'));
        cacheFor(c, CACHE_TTL.entity);
        return c.json(artists);
      },
    )
    .get('/collections/:id', async (c) => {
      const collection = await catalog.getCollection(c.req.param('id'));
      cacheFor(c, CACHE_TTL.entity);
      return c.json(collection);
    })
    .get(
      '/radio/top',
      validate('query', z.object({ tag: tag.optional(), limit: limitParam(100, 30) })),
      async (c) => {
        const stations = await catalog.radioTop(c.req.valid('query'));
        cacheFor(c, CACHE_TTL.trending);
        return c.json(stations);
      },
    )
    .get(
      '/radio/search',
      validate(
        'query',
        z.object({ q: queryText.optional(), tag: tag.optional(), limit: limitParam(100, 30) }),
      ),
      async (c) => {
        const { q, tag, limit } = c.req.valid('query');
        // A name search wins; a tag alone lists that tag's top stations.
        if (q) {
          const stations = await catalog.radioSearch(q, { limit });
          cacheFor(c, CACHE_TTL.search);
          return c.json(stations);
        }
        if (!tag) throw new ApiError('BAD_REQUEST', 'Pass q or tag');
        const stations = await catalog.radioTop({ tag, limit });
        cacheFor(c, CACHE_TTL.trending);
        return c.json(stations);
      },
    );
}
```

`packages/api/src/app.ts`: import the routes and mount them first, ahead of `/me`:
```ts
import { catalogRoutes } from './routes/catalog';
```
```ts
    .use('*', requireUser(deps.auth))
    .route('/', catalogRoutes(deps.catalog))
    .route('/', meRoutes());
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/api test && pnpm --filter @riff/api typecheck`
Expected: PASS (43 tests) and a clean typecheck. The guard test now also covers the catalog routes.

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add packages/api
git commit -m "feat(api): add catalog routes with validation and cache headers"
```

---

### Task 4: Track snapshots and likes

**Files:**
- Create: `packages/api/src/library/snapshots.ts`, `packages/api/src/library/likes.ts`, `packages/api/src/routes/likes.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/routes/likes.test.ts`

**Interfaces:**
- Consumes: `tracks` and `likedTracks` from Task 1; `validate` and `AppDeps` from Task 2; `EntityIdSchema` from `@riff/core`.
- Produces:
  - `saveTrackSnapshots(db, catalog, ids: readonly string[]): Promise<Track[]>`
    - Fetches each distinct id through the catalog and upserts one row per id.
    - Returns the tracks in the requested order, repeats included.
    - Rejects with the catalog's error if any id fails; nothing is written in that case.
  - `saveTrackSnapshot(db, catalog, id): Promise<Track>`
  - `LikesCursorSchema`: a cursor string `<likedAt epoch ms>_<trackId>`, parsed to `{ likedAt: Date; trackId: string }`.
  - `like`, `unlike`, `listLikes(db, userId, cursor?): Promise<LikesPage>`, `likedTrackIds(db, userId): Promise<EntityId[]>`, and `LIKES_PAGE_SIZE = 50`.
  - `interface LikedTrack { track: Track; likedAt: string }` and `interface LikesPage { items: LikedTrack[]; nextCursor: string | null }`.
  - Routes (`likeRoutes({ db, catalog })`):
    - `GET /me/likes?cursor=` returns `LikesPage`, newest first.
    - `GET /me/likes/ids` returns `EntityId[]`, newest first.
    - `PUT /me/likes/:trackId` returns 204. It snapshots the track, and repeating it is a no-op that keeps the original like time.
    - `DELETE /me/likes/:trackId` returns 204. It is idempotent and makes no upstream call.
    - A malformed `trackId` is 400.

Paging is keyset on `(created_at DESC, track_id DESC)`, so ties on the timestamp are broken by track id. The comparison uses Drizzle operators, not a raw `sql` row comparison, so the `Date` goes through the column's own mapping.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routes/likes.test.ts`:
```ts
import { CatalogError } from '@riff/catalog';
import { likedTracks, tracks } from '@riff/db';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(makeTrack(1), makeTrack(2), makeTrack(3));
});

const likedIds = async (user: TestUser) => (await user.get('/me/likes/ids')).json();

describe('PUT /me/likes/:trackId', () => {
  test('likes a track and stores its snapshot', async () => {
    const res = await alice.put('/me/likes/audius:t1');
    expect(res.status).toBe(204);
    expect(await likedIds(alice)).toEqual(['audius:t1']);

    const [row] = await api.db.select().from(tracks).where(eq(tracks.id, 'audius:t1'));
    expect(row).toMatchObject({
      source: 'audius',
      title: 'Track 1',
      artistName: 'Artist 1',
      data: makeTrack(1),
    });
  });

  test('is idempotent and keeps the original like time', async () => {
    await alice.put('/me/likes/audius:t1');
    const [first] = await api.db.select().from(likedTracks);
    await alice.put('/me/likes/audius:t1');
    const rows = await api.db.select().from(likedTracks);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt).toEqual(first!.createdAt);
  });

  test('refreshes an existing snapshot with the latest catalog data', async () => {
    await alice.put('/me/likes/audius:t1');
    api.catalog.addTracks(makeTrack(1, { title: 'Track 1 (Remastered)' }));
    await alice.put('/me/likes/audius:t1');
    const [row] = await api.db.select().from(tracks).where(eq(tracks.id, 'audius:t1'));
    expect(row!.title).toBe('Track 1 (Remastered)');
  });

  test('stores radio stations, which have no artists', async () => {
    api.catalog.addTracks(
      makeTrack('r', {
        id: 'radio:abc',
        source: 'radio',
        artists: [],
        durationSec: null,
        isLive: true,
      }),
    );
    expect((await alice.put('/me/likes/radio:abc')).status).toBe(204);
    const [row] = await api.db.select().from(tracks).where(eq(tracks.id, 'radio:abc'));
    expect(row!.artistName).toBe('');
  });

  test('an unknown track is 404 and nothing is stored', async () => {
    const res = await alice.put('/me/likes/audius:nope');
    expect(res.status).toBe(404);
    expect(await likedIds(alice)).toEqual([]);
  });

  test('an upstream failure is 502 and nothing is stored', async () => {
    api.catalog.getTrack.mockRejectedValueOnce(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect((await alice.put('/me/likes/audius:t1')).status).toBe(502);
    expect(await api.db.$count(tracks)).toBe(0);
  });

  test('a malformed id is 400', async () => {
    const res = await alice.put('/me/likes/not-an-id');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/^trackId: /);
  });
});

describe('DELETE /me/likes/:trackId', () => {
  test('unlikes, and unliking again is still 204', async () => {
    await alice.put('/me/likes/audius:t1');
    expect((await alice.delete('/me/likes/audius:t1')).status).toBe(204);
    expect((await alice.delete('/me/likes/audius:t1')).status).toBe(204);
    expect(await likedIds(alice)).toEqual([]);
  });

  test('works while the catalog is down (no upstream call)', async () => {
    await alice.put('/me/likes/audius:t1');
    api.catalog.getTrack.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect((await alice.delete('/me/likes/audius:t1')).status).toBe(204);
  });
});

describe('GET /me/likes', () => {
  test('lists newest first with the like time, from the DB even when the catalog is down', async () => {
    await alice.put('/me/likes/audius:t1');
    await alice.put('/me/likes/audius:t2');
    api.catalog.getTrack.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));

    const res = await alice.get('/me/likes');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((item: { track: { id: string } }) => item.track.id)).toEqual([
      'audius:t2',
      'audius:t1',
    ]);
    expect(body.items[0].track).toEqual(makeTrack(2));
    expect(Date.parse(body.items[0].likedAt)).not.toBeNaN();
    expect(body.nextCursor).toBeNull();
  });

  test('pages through 120 likes, 50 at a time, without gaps or repeats even on equal timestamps', async () => {
    const all = Array.from({ length: 120 }, (_, i) => makeTrack(`p${i}`));
    api.catalog.addTracks(...all);
    for (const track of all) await alice.put(`/me/likes/${track.id}`);
    // 31 likes (tp1, tp10-tp19, tp100-tp119) share one timestamp, as after a bulk import; the
    // oldest-first tail puts the page 2/3 boundary inside that group.
    await api.db.execute(
      sql`update liked_tracks set created_at = '2026-01-01T00:00:00Z' where track_id like 'audius:tp1%'`,
    );

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const path: string = cursor ? `/me/likes?cursor=${encodeURIComponent(cursor)}` : '/me/likes';
      const body: { items: { track: { id: string } }[]; nextCursor: string | null } = await (
        await alice.get(path)
      ).json();
      pageSizes.push(body.items.length);
      seen.push(...body.items.map((item) => item.track.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(pageSizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual(await likedIds(alice));
  });

  test('a malformed cursor is 400', async () => {
    expect((await alice.get('/me/likes?cursor=garbage')).status).toBe(400);
  });

  test('likes are private to each user', async () => {
    await alice.put('/me/likes/audius:t1');
    const bob = await api.signUp('bob');
    expect(await likedIds(bob)).toEqual([]);
    expect((await (await bob.get('/me/likes')).json()).items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @riff/api exec vitest run src/routes/likes.test.ts`
Expected: FAIL. The routes return 404 (for example, `expected 404 to be 204`).

- [ ] **Step 3: Implement snapshots and likes**

`packages/api/src/library/snapshots.ts`:
```ts
import type { Catalog } from '@riff/catalog';
import type { Track } from '@riff/core';
import { type Db, tracks } from '@riff/db';
import { sql } from 'drizzle-orm';

/**
 * Fetches tracks through the (cached) catalog and upserts them into `tracks`, so library reads
 * never depend on an upstream. Returns them in the order asked, repeats included.
 * Rejects with the catalog's error (404 / 502 / 504) if any id fails.
 */
export async function saveTrackSnapshots(
  db: Db,
  catalog: Catalog,
  ids: readonly string[],
): Promise<Track[]> {
  const unique = [...new Set(ids)];
  const fetched = await Promise.all(unique.map((id) => catalog.getTrack(id)));
  // One row per id: ON CONFLICT cannot touch the same row twice in one statement.
  await db
    .insert(tracks)
    .values(
      fetched.map((track) => ({
        id: track.id,
        source: track.source,
        title: track.title,
        artistName: track.artists[0]?.name ?? '',
        data: track,
      })),
    )
    .onConflictDoUpdate({
      target: tracks.id,
      set: {
        source: sql`excluded.source`,
        title: sql`excluded.title`,
        artistName: sql`excluded.artist_name`,
        data: sql`excluded.data`,
        updatedAt: sql`now()`,
      },
    });
  const byId = new Map(unique.map((id, i) => [id, fetched[i]!]));
  return ids.map((id) => byId.get(id)!);
}

export async function saveTrackSnapshot(db: Db, catalog: Catalog, id: string): Promise<Track> {
  const [track] = await saveTrackSnapshots(db, catalog, [id]);
  return track!;
}
```

`packages/api/src/library/likes.ts`:
```ts
import type { EntityId, Track } from '@riff/core';
import { type Db, likedTracks, tracks } from '@riff/db';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';

export const LIKES_PAGE_SIZE = 50;

export interface LikedTrack {
  track: Track;
  likedAt: string;
}

export interface LikesPage {
  items: LikedTrack[];
  /** Pass back as `?cursor=` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

interface Cursor {
  likedAt: Date;
  trackId: string;
}

/** `<likedAt epoch ms>_<trackId>`: the keyset position of the last item on a page. */
export const LikesCursorSchema = z
  .string()
  .regex(/^\d{1,15}_.+$/, 'Invalid cursor')
  .transform((value): Cursor => {
    const split = value.indexOf('_');
    return {
      likedAt: new Date(Number(value.slice(0, split))),
      trackId: value.slice(split + 1),
    };
  });

const encodeCursor = ({ likedAt, trackId }: Cursor) => `${likedAt.getTime()}_${trackId}`;

export async function like(db: Db, userId: string, trackId: string): Promise<void> {
  await db.insert(likedTracks).values({ userId, trackId }).onConflictDoNothing();
}

export async function unlike(db: Db, userId: string, trackId: string): Promise<void> {
  await db
    .delete(likedTracks)
    .where(and(eq(likedTracks.userId, userId), eq(likedTracks.trackId, trackId)));
}

/** Newest first. Ties on likedAt are broken by track id, so pages never skip or repeat. */
export async function listLikes(db: Db, userId: string, cursor?: Cursor): Promise<LikesPage> {
  const rows = await db
    .select({ track: tracks.data, trackId: likedTracks.trackId, likedAt: likedTracks.createdAt })
    .from(likedTracks)
    .innerJoin(tracks, eq(tracks.id, likedTracks.trackId))
    .where(
      and(
        eq(likedTracks.userId, userId),
        cursor &&
          or(
            lt(likedTracks.createdAt, cursor.likedAt),
            and(eq(likedTracks.createdAt, cursor.likedAt), lt(likedTracks.trackId, cursor.trackId)),
          ),
      ),
    )
    .orderBy(desc(likedTracks.createdAt), desc(likedTracks.trackId))
    .limit(LIKES_PAGE_SIZE + 1);

  const page = rows.slice(0, LIKES_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ track: row.track, likedAt: row.likedAt.toISOString() })),
    nextCursor: rows.length > LIKES_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

export async function likedTrackIds(db: Db, userId: string): Promise<EntityId[]> {
  const rows = await db
    .select({ trackId: likedTracks.trackId })
    .from(likedTracks)
    .where(eq(likedTracks.userId, userId))
    .orderBy(desc(likedTracks.createdAt), desc(likedTracks.trackId));
  return rows.map((row) => row.trackId as EntityId);
}
```

`packages/api/src/routes/likes.ts`:
```ts
import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { LikesCursorSchema, like, likedTrackIds, listLikes, unlike } from '../library/likes';
import { saveTrackSnapshot } from '../library/snapshots';
import { validate } from '../validation';

const trackParam = validate('param', z.object({ trackId: EntityIdSchema }));

export function likeRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .get(
      '/me/likes',
      validate('query', z.object({ cursor: LikesCursorSchema.optional() })),
      async (c) => c.json(await listLikes(db, c.get('user').id, c.req.valid('query').cursor)),
    )
    .get('/me/likes/ids', async (c) => c.json(await likedTrackIds(db, c.get('user').id)))
    .put('/me/likes/:trackId', trackParam, async (c) => {
      const track = await saveTrackSnapshot(db, catalog, c.req.valid('param').trackId);
      await like(db, c.get('user').id, track.id);
      return c.body(null, 204);
    })
    .delete('/me/likes/:trackId', trackParam, async (c) => {
      await unlike(db, c.get('user').id, c.req.valid('param').trackId);
      return c.body(null, 204);
    });
}
```

`packages/api/src/app.ts`: add the import and mount the routes after `/me`:
```ts
import { likeRoutes } from './routes/likes';
```
```ts
    .route('/', meRoutes())
    .route('/', likeRoutes(deps));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/api test && pnpm --filter @riff/api typecheck`
Expected: PASS (56 tests) and a clean typecheck.

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add packages/api
git commit -m "feat(api): add track snapshots and likes with keyset pagination"
```

---

### Task 5: Playlists

**Files:**
- Create: `packages/api/src/library/playlists.ts`, `packages/api/src/routes/playlists.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/routes/playlists.test.ts`

**Interfaces:**
- Consumes: `playlists`, `playlistTracks` and `tracks` from Task 1; `saveTrackSnapshots` from Task 4; `notFound`, `validate` and `AppDeps` from Task 2; `generateKeyBetween` and `generateNKeysBetween` from `fractional-indexing`.
- Produces:
  - `PlaylistSummary`: `{ id, name, description, coverUrl, isPublic, trackCount, covers: string[], createdAt, updatedAt }`. `covers` holds the artwork (md, else sm, else lg) of the first four entries that have any, in playlist order.
  - `PlaylistEntry`: `{ id, track, addedAt }`. `id` is the entry id.
  - `PlaylistDetail`: `PlaylistSummary & { ownerId, isOwner, entries }`.
  - Library functions: `listPlaylists`, `createPlaylist`, `getPlaylist`, `updatePlaylist`, `deletePlaylist`, `assertOwnsPlaylist`, `appendEntries`, `moveEntry` and `removeEntry`.
  - Routes (`playlistRoutes({ db, catalog })`):
    - `GET /me/playlists` returns `PlaylistSummary[]`, most recently changed first.
    - `POST /me/playlists` takes `{ name, description? }` and returns 201 with a summary. The name is trimmed, 1–100 characters; a blank description becomes `null`.
    - `GET /playlists/:id` returns `PlaylistDetail`, for the owner or, when `isPublic`, for any signed-in user.
    - `PATCH /me/playlists/:id` takes `{ name?, description?, isPublic? }` (at least one) and returns the summary.
    - `DELETE /me/playlists/:id` returns 204.
    - `POST /me/playlists/:id/tracks` takes `{ trackIds: EntityId[] }` (1–100) and returns 201 `{ entries }`, appended in request order.
    - `PATCH /me/playlists/:id/tracks/:entryId` takes `{ afterEntryId: uuid | null }` and returns 204. `null` moves the entry to the top.
    - `DELETE /me/playlists/:id/tracks/:entryId` returns 204.
  - Error rules:
    - A non-UUID `:id` or `:entryId` is 400.
    - Someone else's private playlist, or an unknown entry, is 404.
    - Every edit bumps `updated_at`.

Design notes:
- **Locking.** Appends, moves and removals lock the playlist row (`SELECT … FOR UPDATE`) inside a transaction, so concurrent edits to one playlist are serialised and `UNIQUE (playlist_id, position)` never trips.
- **Snapshot before the transaction.** The snapshot fetch (an upstream call) happens before the transaction, after a non-locking ownership check. So a foreign playlist is a plain 404 with no upstream call, and no row lock is held across the network.
- **Moves.** A move computes one key between the target's position and the next position, excluding the moved entry, and updates only that row. Moving an entry after itself is a no-op.
- **Plain SQL in subqueries.** `summaryColumns` uses plain SQL for its correlated subqueries. Drizzle renders `${playlists.id}` as a bare `"id"` in a single-table select, and inside the subquery that resolves to `playlist_tracks.id`. This was verified: it breaks the query.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routes/playlists.test.ts`:
```ts
import { CatalogError } from '@riff/catalog';
import { playlistTracks } from '@riff/db';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(...Array.from({ length: 5 }, (_, i) => makeTrack(i + 1)));
});

async function createPlaylist(user: TestUser, name = 'Mix'): Promise<string> {
  const res = await user.post('/me/playlists', { name });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

async function addTracks(user: TestUser, playlistId: string, trackIds: string[]) {
  const res = await user.post(`/me/playlists/${playlistId}/tracks`, { trackIds });
  expect(res.status).toBe(201);
  return (await res.json()).entries as { id: string; track: { id: string } }[];
}

async function trackOrder(user: TestUser, playlistId: string): Promise<string[]> {
  const body = await (await user.get(`/playlists/${playlistId}`)).json();
  return body.entries.map((entry: { track: { id: string } }) => entry.track.id);
}

describe('playlist CRUD', () => {
  test('creates, lists, renames and deletes', async () => {
    const created = await (
      await alice.post('/me/playlists', { name: '  Road trip  ', description: 'Loud' })
    ).json();
    expect(created).toMatchObject({
      name: 'Road trip',
      description: 'Loud',
      coverUrl: null,
      isPublic: false,
      trackCount: 0,
      covers: [],
    });

    const renamed = await alice.patch(`/me/playlists/${created.id}`, {
      name: 'Night drive',
      description: '',
      isPublic: true,
    });
    expect(await renamed.json()).toMatchObject({
      name: 'Night drive',
      description: null,
      isPublic: true,
    });

    const list = await (await alice.get('/me/playlists')).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(['Night drive']);

    expect((await alice.delete(`/me/playlists/${created.id}`)).status).toBe(204);
    expect(await (await alice.get('/me/playlists')).json()).toEqual([]);
    expect((await alice.get(`/playlists/${created.id}`)).status).toBe(404);
  });

  test('lists the most recently changed playlist first', async () => {
    const older = await createPlaylist(alice, 'Older');
    await createPlaylist(alice, 'Newer');
    await addTracks(alice, older, ['audius:t1']);
    const list = await (await alice.get('/me/playlists')).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(['Older', 'Newer']);
  });

  test.each([
    ['a blank name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['no name', {}],
  ])('rejects %s', async (_, body) => {
    const res = await alice.post('/me/playlists', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  test('an empty PATCH is 400', async () => {
    const id = await createPlaylist(alice);
    const res = await alice.patch(`/me/playlists/${id}`, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Nothing to change');
  });

  test('malformed JSON is 400, not 500', async () => {
    const res = await api.app.request('/api/me/playlists', {
      method: 'POST',
      headers: { cookie: alice.cookie, 'content-type': 'application/json' },
      body: '{"name": ',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('BAD_REQUEST');
  });

  test('a non-UUID playlist id is 400, not a database error', async () => {
    const res = await alice.get('/playlists/not-a-uuid');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/^id: /);
  });
});

describe('entries', () => {
  test('appends in request order, allows duplicates, and reports count and covers', async () => {
    const id = await createPlaylist(alice);
    await addTracks(alice, id, ['audius:t1', 'audius:t2']);
    const added = await addTracks(alice, id, ['audius:t3', 'audius:t1', 'audius:t4', 'audius:t5']);
    expect(added.map((e) => e.track.id)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t4',
      'audius:t5',
    ]);
    expect(new Set(added.map((e) => e.id)).size).toBe(4);

    expect(await trackOrder(alice, id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
      'audius:t1',
      'audius:t4',
      'audius:t5',
    ]);
    const [summary] = await (await alice.get('/me/playlists')).json();
    expect(summary.trackCount).toBe(6);
    expect(summary.covers).toEqual([
      'https://img.example/t1/480.jpg',
      'https://img.example/t2/480.jpg',
      'https://img.example/t3/480.jpg',
      'https://img.example/t1/480.jpg',
    ]);
  });

  test('keeps order across 70 single appends (fractional keys sort byte-wise)', async () => {
    const many = Array.from({ length: 70 }, (_, i) => makeTrack(`m${i}`));
    api.catalog.addTracks(...many);
    const id = await createPlaylist(alice);
    for (const track of many) await addTracks(alice, id, [track.id]);
    expect(await trackOrder(alice, id)).toEqual(many.map((track) => track.id));
  });

  test('covers skip tracks without artwork', async () => {
    api.catalog.addTracks(makeTrack('bare', { artwork: {} }));
    const id = await createPlaylist(alice);
    await addTracks(alice, id, ['audius:tbare', 'audius:t2']);
    const [summary] = await (await alice.get('/me/playlists')).json();
    expect(summary.covers).toEqual(['https://img.example/t2/480.jpg']);
  });

  test('an unknown track rejects the whole request and adds nothing', async () => {
    const id = await createPlaylist(alice);
    const res = await alice.post(`/me/playlists/${id}/tracks`, {
      trackIds: ['audius:t1', 'audius:nope'],
    });
    expect(res.status).toBe(404);
    expect(await api.db.$count(playlistTracks)).toBe(0);
  });

  test('an upstream failure while snapshotting is 502', async () => {
    const id = await createPlaylist(alice);
    api.catalog.getTrack.mockRejectedValueOnce(new CatalogError('UPSTREAM_ERROR', 'down'));
    const res = await alice.post(`/me/playlists/${id}/tracks`, { trackIds: ['audius:t1'] });
    expect(res.status).toBe(502);
  });

  test.each([
    ['an empty list', { trackIds: [] }],
    ['more than 100 ids', { trackIds: Array.from({ length: 101 }, () => 'audius:t1') }],
    ['a malformed id', { trackIds: ['nope'] }],
  ])('rejects %s', async (_, body) => {
    const id = await createPlaylist(alice);
    expect((await alice.post(`/me/playlists/${id}/tracks`, body)).status).toBe(400);
  });

  test('removes one entry, leaving the duplicate', async () => {
    const id = await createPlaylist(alice);
    const [first] = await addTracks(alice, id, ['audius:t1', 'audius:t2', 'audius:t1']);
    expect((await alice.delete(`/me/playlists/${id}/tracks/${first!.id}`)).status).toBe(204);
    expect(await trackOrder(alice, id)).toEqual(['audius:t2', 'audius:t1']);
    expect((await alice.delete(`/me/playlists/${id}/tracks/${first!.id}`)).status).toBe(404);
  });
});

describe('reorder', () => {
  let id: string;
  let entries: { id: string }[];

  beforeEach(async () => {
    id = await createPlaylist(alice);
    entries = await addTracks(alice, id, ['audius:t1', 'audius:t2', 'audius:t3', 'audius:t4']);
  });

  const move = (entryIndex: number, afterIndex: number | null) =>
    alice.patch(`/me/playlists/${id}/tracks/${entries[entryIndex]!.id}`, {
      afterEntryId: afterIndex === null ? null : entries[afterIndex]!.id,
    });

  test('moves an entry to the top', async () => {
    expect((await move(2, null)).status).toBe(204);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t2',
      'audius:t4',
    ]);
  });

  test('moves an entry down, into the middle and to the end', async () => {
    await move(0, 2);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t2',
      'audius:t3',
      'audius:t1',
      'audius:t4',
    ]);
    await move(1, 3);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t4',
      'audius:t2',
    ]);
  });

  test('moving an entry after itself or to where it already is changes nothing', async () => {
    await move(1, 1);
    await move(1, 0);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
      'audius:t4',
    ]);
  });

  test('stays consistent over many moves between the same neighbours', async () => {
    for (let i = 0; i < 30; i++) await move(i % 2 === 0 ? 3 : 2, 0);
    expect(await trackOrder(alice, id)).toEqual([
      'audius:t1',
      'audius:t3',
      'audius:t4',
      'audius:t2',
    ]);
  });

  test('an unknown afterEntryId is 404', async () => {
    const res = await alice.patch(`/me/playlists/${id}/tracks/${entries[0]!.id}`, {
      afterEntryId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe('No such playlist entry');
  });

  test('afterEntryId must be a UUID or null', async () => {
    const res = await alice.patch(`/me/playlists/${id}/tracks/${entries[0]!.id}`, {});
    expect(res.status).toBe(400);
  });
});

describe('ownership and visibility', () => {
  let bob: TestUser;
  let id: string;

  beforeEach(async () => {
    id = await createPlaylist(alice);
    await addTracks(alice, id, ['audius:t1']);
    bob = await api.signUp('bob');
  });

  test("another user's private playlist is 404 to read and to change", async () => {
    expect((await bob.get(`/playlists/${id}`)).status).toBe(404);
    expect((await bob.patch(`/me/playlists/${id}`, { name: 'Mine now' })).status).toBe(404);
    expect((await bob.delete(`/me/playlists/${id}`)).status).toBe(404);
    expect((await bob.post(`/me/playlists/${id}/tracks`, { trackIds: ['audius:t2'] })).status).toBe(
      404,
    );
    expect(api.catalog.getTrack).not.toHaveBeenCalledWith('audius:t2');
    expect(await trackOrder(alice, id)).toEqual(['audius:t1']);
  });

  test('a public playlist is readable by others, but only its owner may edit it', async () => {
    await alice.patch(`/me/playlists/${id}`, { isPublic: true });
    const res = await bob.get(`/playlists/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      isOwner: false,
      entries: [{ track: { id: 'audius:t1' } }],
    });
    expect((await bob.patch(`/me/playlists/${id}`, { name: 'x' })).status).toBe(404);
    expect((await (await alice.get(`/playlists/${id}`)).json()).isOwner).toBe(true);
  });

  test("the list shows only the user's own playlists", async () => {
    await alice.patch(`/me/playlists/${id}`, { isPublic: true });
    expect(await (await bob.get('/me/playlists')).json()).toEqual([]);
  });

  test('playlist reads come from the DB while the catalog is down', async () => {
    api.catalog.getTrack.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect(await trackOrder(alice, id)).toEqual(['audius:t1']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @riff/api exec vitest run src/routes/playlists.test.ts`
Expected: FAIL, with `expected 404 to be 201` from `createPlaylist`.

- [ ] **Step 3: Implement the playlist library**

`packages/api/src/library/playlists.ts`:
```ts
import type { Track } from '@riff/core';
import { type Db, playlists, playlistTracks, tracks } from '@riff/db';
import { and, asc, desc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { notFound } from '../errors';

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  /** null: the UI renders a mosaic of `covers`. */
  coverUrl: string | null;
  isPublic: boolean;
  trackCount: number;
  /** Artwork of the first (up to) four entries that have any, in playlist order. */
  covers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistEntry {
  /** Entry id (a track may appear more than once). */
  id: string;
  track: Track;
  addedAt: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  ownerId: string;
  isOwner: boolean;
  entries: PlaylistEntry[];
}

export interface PlaylistPatch {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A track's cover for mosaics: the ~480 px artwork, else whatever size exists. */
const COVER_SQL = sql.raw(
  "coalesce(t.data->'artwork'->>'md', t.data->'artwork'->>'sm', t.data->'artwork'->>'lg')",
);

const summaryColumns = {
  id: playlists.id,
  ownerId: playlists.ownerId,
  name: playlists.name,
  description: playlists.description,
  coverUrl: playlists.coverUrl,
  isPublic: playlists.isPublic,
  createdAt: playlists.createdAt,
  updatedAt: playlists.updatedAt,
  // Plain SQL: Drizzle renders columns unqualified in single-table selects, which would make
  // `playlists.id` ambiguous inside these correlated subqueries.
  trackCount: sql<number>`(
    select count(*) from playlist_tracks pt where pt.playlist_id = playlists.id
  )`.mapWith(Number),
  covers: sql<string[]>`coalesce((
    select array_agg(firsts.cover order by firsts.position) from (
      select ${COVER_SQL} as cover, pt.position
      from playlist_tracks pt join tracks t on t.id = pt.track_id
      where pt.playlist_id = playlists.id and ${COVER_SQL} is not null
      order by pt.position
      limit 4
    ) firsts
  ), '{}')`,
};

interface SummaryRow {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  isPublic: boolean;
  trackCount: number;
  covers: string[];
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(row: SummaryRow): PlaylistSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    coverUrl: row.coverUrl,
    isPublic: row.isPublic,
    trackCount: row.trackCount,
    covers: row.covers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findSummary(db: Db | Tx, id: string, ownerId: string): Promise<PlaylistSummary> {
  const [row] = await db
    .select(summaryColumns)
    .from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)));
  if (!row) throw notFound('No such playlist');
  return toSummary(row);
}

/** Locks the playlist row so concurrent edits of one playlist are serialised. */
async function lockOwned(tx: Tx, ownerId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)))
    .for('update');
  if (!row) throw notFound('No such playlist');
}

async function touch(tx: Tx, id: string): Promise<void> {
  await tx.update(playlists).set({ updatedAt: sql`now()` }).where(eq(playlists.id, id));
}

/** The user's playlists, most recently changed first. */
export async function listPlaylists(db: Db, ownerId: string): Promise<PlaylistSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(playlists)
    .where(eq(playlists.ownerId, ownerId))
    .orderBy(desc(playlists.updatedAt), desc(playlists.createdAt));
  return rows.map(toSummary);
}

export async function createPlaylist(
  db: Db,
  ownerId: string,
  input: { name: string; description?: string | null },
): Promise<PlaylistSummary> {
  const [row] = await db
    .insert(playlists)
    .values({ ownerId, name: input.name, description: input.description ?? null })
    .returning({ id: playlists.id });
  return findSummary(db, row!.id, ownerId);
}

/** Visible to its owner, or to any signed-in user when public. */
export async function getPlaylist(db: Db, viewerId: string, id: string): Promise<PlaylistDetail> {
  const [row] = await db
    .select(summaryColumns)
    .from(playlists)
    .where(
      and(eq(playlists.id, id), or(eq(playlists.ownerId, viewerId), eq(playlists.isPublic, true))),
    );
  if (!row) throw notFound('No such playlist');

  const entries = await db
    .select({ id: playlistTracks.id, track: tracks.data, addedAt: playlistTracks.addedAt })
    .from(playlistTracks)
    .innerJoin(tracks, eq(tracks.id, playlistTracks.trackId))
    .where(eq(playlistTracks.playlistId, id))
    .orderBy(asc(playlistTracks.position));

  return {
    ...toSummary(row),
    ownerId: row.ownerId,
    isOwner: row.ownerId === viewerId,
    entries: entries.map((entry) => ({ ...entry, addedAt: entry.addedAt.toISOString() })),
  };
}

export async function updatePlaylist(
  db: Db,
  ownerId: string,
  id: string,
  patch: PlaylistPatch,
): Promise<PlaylistSummary> {
  const updated = await db
    .update(playlists)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)))
    .returning({ id: playlists.id });
  if (updated.length === 0) throw notFound('No such playlist');
  return findSummary(db, id, ownerId);
}

export async function deletePlaylist(db: Db, ownerId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.ownerId, ownerId)))
    .returning({ id: playlists.id });
  if (deleted.length === 0) throw notFound('No such playlist');
}

/** Throws 404 unless `ownerId` owns the playlist; cheap pre-check before upstream calls. */
export async function assertOwnsPlaylist(db: Db, ownerId: string, id: string): Promise<void> {
  await findSummary(db, id, ownerId);
}

/** Appends tracks (already snapshotted) in the given order after the current last entry. */
export async function appendEntries(
  db: Db,
  ownerId: string,
  playlistId: string,
  items: readonly Track[],
): Promise<PlaylistEntry[]> {
  return db.transaction(async (tx) => {
    await lockOwned(tx, ownerId, playlistId);
    const [last] = await tx
      .select({ position: playlistTracks.position })
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, playlistId))
      .orderBy(desc(playlistTracks.position))
      .limit(1);
    const keys = generateNKeysBetween(last?.position ?? null, null, items.length);
    const rows = await tx
      .insert(playlistTracks)
      .values(items.map((track, i) => ({ playlistId, trackId: track.id, position: keys[i]! })))
      .returning({ id: playlistTracks.id, addedAt: playlistTracks.addedAt });
    await touch(tx, playlistId);
    return rows.map((row, i) => ({
      id: row.id,
      track: items[i]!,
      addedAt: row.addedAt.toISOString(),
    }));
  });
}

/** Moves an entry to just after `afterEntryId` (null = to the top). Only one row changes. */
export async function moveEntry(
  db: Db,
  ownerId: string,
  playlistId: string,
  entryId: string,
  afterEntryId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwned(tx, ownerId, playlistId);
    const position = async (id: string) => {
      const [row] = await tx
        .select({ position: playlistTracks.position })
        .from(playlistTracks)
        .where(and(eq(playlistTracks.id, id), eq(playlistTracks.playlistId, playlistId)));
      if (!row) throw notFound('No such playlist entry');
      return row.position;
    };

    await position(entryId);
    if (afterEntryId === entryId) return;
    const lower = afterEntryId === null ? null : await position(afterEntryId);
    const [next] = await tx
      .select({ position: playlistTracks.position })
      .from(playlistTracks)
      .where(
        and(
          eq(playlistTracks.playlistId, playlistId),
          ne(playlistTracks.id, entryId),
          lower === null ? undefined : gt(playlistTracks.position, lower),
        ),
      )
      .orderBy(asc(playlistTracks.position))
      .limit(1);

    await tx
      .update(playlistTracks)
      .set({ position: generateKeyBetween(lower, next?.position ?? null) })
      .where(eq(playlistTracks.id, entryId));
    await touch(tx, playlistId);
  });
}

export async function removeEntry(
  db: Db,
  ownerId: string,
  playlistId: string,
  entryId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwned(tx, ownerId, playlistId);
    const deleted = await tx
      .delete(playlistTracks)
      .where(and(eq(playlistTracks.id, entryId), eq(playlistTracks.playlistId, playlistId)))
      .returning({ id: playlistTracks.id });
    if (deleted.length === 0) throw notFound('No such playlist entry');
    await touch(tx, playlistId);
  });
}
```

- [ ] **Step 4: Implement the routes**

`packages/api/src/routes/playlists.ts`:
```ts
import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import {
  appendEntries,
  assertOwnsPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  moveEntry,
  removeEntry,
  updatePlaylist,
} from '../library/playlists';
import { saveTrackSnapshots } from '../library/snapshots';
import { validate } from '../validation';

const name = z.string().trim().min(1).max(100);
/** Blank descriptions are stored as null. */
const description = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .transform((value) => value || null);

const playlistParam = validate('param', z.object({ id: z.uuid() }));
const entryParam = validate('param', z.object({ id: z.uuid(), entryId: z.uuid() }));

export function playlistRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .get('/me/playlists', async (c) => c.json(await listPlaylists(db, c.get('user').id)))
    .post(
      '/me/playlists',
      validate('json', z.object({ name, description: description.optional() })),
      async (c) => c.json(await createPlaylist(db, c.get('user').id, c.req.valid('json')), 201),
    )
    .get('/playlists/:id', playlistParam, async (c) =>
      c.json(await getPlaylist(db, c.get('user').id, c.req.valid('param').id)),
    )
    .patch(
      '/me/playlists/:id',
      playlistParam,
      validate(
        'json',
        z
          .object({
            name: name.optional(),
            description: description.optional(),
            isPublic: z.boolean().optional(),
          })
          .refine(
            (patch) => Object.values(patch).some((v) => v !== undefined),
            'Nothing to change',
          ),
      ),
      async (c) =>
        c.json(
          await updatePlaylist(db, c.get('user').id, c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .delete('/me/playlists/:id', playlistParam, async (c) => {
      await deletePlaylist(db, c.get('user').id, c.req.valid('param').id);
      return c.body(null, 204);
    })
    .post(
      '/me/playlists/:id/tracks',
      playlistParam,
      validate('json', z.object({ trackIds: z.array(EntityIdSchema).min(1).max(100) })),
      async (c) => {
        const userId = c.get('user').id;
        const { id } = c.req.valid('param');
        // Check ownership before any upstream call, so a foreign playlist is a plain 404.
        await assertOwnsPlaylist(db, userId, id);
        const items = await saveTrackSnapshots(db, catalog, c.req.valid('json').trackIds);
        return c.json({ entries: await appendEntries(db, userId, id, items) }, 201);
      },
    )
    .patch(
      '/me/playlists/:id/tracks/:entryId',
      entryParam,
      validate('json', z.object({ afterEntryId: z.uuid().nullable() })),
      async (c) => {
        const { id, entryId } = c.req.valid('param');
        await moveEntry(db, c.get('user').id, id, entryId, c.req.valid('json').afterEntryId);
        return c.body(null, 204);
      },
    )
    .delete('/me/playlists/:id/tracks/:entryId', entryParam, async (c) => {
      const { id, entryId } = c.req.valid('param');
      await removeEntry(db, c.get('user').id, id, entryId);
      return c.body(null, 204);
    });
}
```

`packages/api/src/app.ts`:
```ts
import { playlistRoutes } from './routes/playlists';
```
```ts
    .route('/', likeRoutes(deps))
    .route('/', playlistRoutes(deps));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/api test && pnpm --filter @riff/api typecheck`
Expected: PASS (83 tests) and a clean typecheck.

- [ ] **Step 6: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add packages/api
git commit -m "feat(api): add playlists with fractional ordering"
```

---

### Task 6: Followed artists and play history

**Files:**
- Create: `packages/api/src/library/following.ts`, `packages/api/src/library/history.ts`, `packages/api/src/routes/following.ts`, `packages/api/src/routes/history.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/routes/following.test.ts`, `packages/api/src/routes/history.test.ts`

**Interfaces:**
- Consumes: `followedArtists`, `playHistory` and `tracks` from Task 1; `saveTrackSnapshot` from Task 4; `validate`, `limitParam` and `AppDeps` from Task 2.
- Produces:
  - Library functions:
    - `follow(db, userId, artist: Artist)` upserts the snapshot and keeps the original follow time.
    - `unfollow(db, userId, artistId)`.
    - `listFollowing(db, userId, limit?): Promise<Artist[]>`, most recently followed first. Task 7 uses the `limit`.
    - `recordPlay(db, userId, { trackId, msPlayed, context? })`.
    - `recentTracks(db, userId, limit): Promise<Track[]>`: distinct tracks by latest play, newest first. Task 7 uses it.
  - Following routes:
    - `GET /me/following` returns `Artist[]`.
    - `PUT /me/following/:artistId` returns 204. It snapshots through `catalog.getArtist`.
    - `DELETE /me/following/:artistId` returns 204, with no upstream call.
  - History routes:
    - `POST /me/history` takes `{ trackId, msPlayed, context? }` and returns 204. `msPlayed` is an integer from 0 to 86 400 000; `context` is 1–200 characters.
    - `GET /me/history/recent?limit=` (1–50, default 20) returns `Track[]`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routes/following.test.ts`:
```ts
import { CatalogError } from '@riff/catalog';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeArtist } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addArtists(makeArtist(1), makeArtist(2));
});

const following = async (user: TestUser) =>
  ((await (await user.get('/me/following')).json()) as { id: string }[]).map((a) => a.id);

describe('following', () => {
  test('follows artists (newest first) with their snapshot', async () => {
    expect((await alice.put('/me/following/audius:a1')).status).toBe(204);
    await alice.put('/me/following/audius:a2');
    const res = await alice.get('/me/following');
    const body = await res.json();
    expect(body.map((a: { id: string }) => a.id)).toEqual(['audius:a2', 'audius:a1']);
    expect(body[1]).toEqual(makeArtist(1));
  });

  test('following twice is idempotent and refreshes the snapshot', async () => {
    await alice.put('/me/following/audius:a1');
    api.catalog.addArtists(makeArtist(1, { name: 'Renamed' }));
    await alice.put('/me/following/audius:a1');
    const body = await (await alice.get('/me/following')).json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Renamed');
  });

  test('unfollow is idempotent and needs no upstream', async () => {
    await alice.put('/me/following/audius:a1');
    api.catalog.getArtist.mockRejectedValue(new CatalogError('UPSTREAM_ERROR', 'down'));
    expect((await alice.delete('/me/following/audius:a1')).status).toBe(204);
    expect((await alice.delete('/me/following/audius:a1')).status).toBe(204);
    expect(await following(alice)).toEqual([]);
  });

  test('an unknown artist is 404; a malformed id is 400', async () => {
    expect((await alice.put('/me/following/audius:nope')).status).toBe(404);
    expect((await alice.put('/me/following/nope')).status).toBe(400);
    expect(await following(alice)).toEqual([]);
  });

  test('is private to each user', async () => {
    await alice.put('/me/following/audius:a1');
    const bob = await api.signUp('bob');
    expect(await following(bob)).toEqual([]);
  });
});
```

`packages/api/src/routes/history.test.ts`:
```ts
import { playHistory } from '@riff/db';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(makeTrack(1), makeTrack(2), makeTrack(3));
});

const recent = async (user: TestUser, query = '') =>
  ((await (await user.get(`/me/history/recent${query}`)).json()) as { id: string }[]).map(
    (t) => t.id,
  );

describe('POST /me/history', () => {
  test('records a play with its context and snapshots the track', async () => {
    const res = await alice.post('/me/history', {
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:abc',
    });
    expect(res.status).toBe(204);
    const [row] = await api.db.select().from(playHistory);
    expect(row).toMatchObject({
      userId: alice.id,
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:abc',
    });
  });

  test.each([
    ['negative msPlayed', { trackId: 'audius:t1', msPlayed: -1 }],
    ['fractional msPlayed', { trackId: 'audius:t1', msPlayed: 1.5 }],
    ['msPlayed over a day', { trackId: 'audius:t1', msPlayed: 86_400_001 }],
    ['a malformed track id', { trackId: 't1', msPlayed: 1 }],
    [
      'a context over 200 characters',
      { trackId: 'audius:t1', msPlayed: 1, context: 'x'.repeat(201) },
    ],
  ])('rejects %s', async (_, body) => {
    expect((await alice.post('/me/history', body)).status).toBe(400);
    expect(await api.db.$count(playHistory)).toBe(0);
  });

  test('an unknown track is 404', async () => {
    expect((await alice.post('/me/history', { trackId: 'audius:nope', msPlayed: 1 })).status).toBe(
      404,
    );
  });
});

describe('GET /me/history/recent', () => {
  test('lists distinct tracks by their latest play, newest first', async () => {
    for (const id of ['audius:t1', 'audius:t2', 'audius:t1', 'audius:t3', 'audius:t2']) {
      await alice.post('/me/history', { trackId: id, msPlayed: 30_000 });
      // Plays within one millisecond would tie; spread them out.
      await api.db.execute(
        sql`update play_history set played_at = played_at - interval '1 minute'`,
      );
    }
    expect(await recent(alice)).toEqual(['audius:t2', 'audius:t3', 'audius:t1']);
    expect(await recent(alice, '?limit=2')).toEqual(['audius:t2', 'audius:t3']);
  });

  test('limit is bounded', async () => {
    expect((await alice.get('/me/history/recent?limit=51')).status).toBe(400);
  });

  test('is private to each user', async () => {
    await alice.post('/me/history', { trackId: 'audius:t1', msPlayed: 30_000 });
    const bob = await api.signUp('bob');
    expect(await recent(bob)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @riff/api exec vitest run src/routes/following.test.ts src/routes/history.test.ts`
Expected: FAIL. The routes return 404.

- [ ] **Step 3: Implement the library functions**

`packages/api/src/library/following.ts`:
```ts
import type { Artist } from '@riff/core';
import { type Db, followedArtists } from '@riff/db';
import { and, desc, eq, sql } from 'drizzle-orm';

/** Stores (or refreshes) the artist snapshot; following again keeps the original follow time. */
export async function follow(db: Db, userId: string, artist: Artist): Promise<void> {
  await db
    .insert(followedArtists)
    .values({ userId, artistId: artist.id, data: artist })
    .onConflictDoUpdate({
      target: [followedArtists.userId, followedArtists.artistId],
      set: { data: sql`excluded.data` },
    });
}

export async function unfollow(db: Db, userId: string, artistId: string): Promise<void> {
  await db
    .delete(followedArtists)
    .where(and(eq(followedArtists.userId, userId), eq(followedArtists.artistId, artistId)));
}

/** Most recently followed first. */
export async function listFollowing(db: Db, userId: string, limit?: number): Promise<Artist[]> {
  const query = db
    .select({ artist: followedArtists.data })
    .from(followedArtists)
    .where(eq(followedArtists.userId, userId))
    .orderBy(desc(followedArtists.createdAt), desc(followedArtists.artistId));
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map((row) => row.artist);
}
```

`packages/api/src/library/history.ts`:
```ts
import type { Track } from '@riff/core';
import { type Db, playHistory, tracks } from '@riff/db';
import { desc, eq, max } from 'drizzle-orm';

export async function recordPlay(
  db: Db,
  userId: string,
  play: { trackId: string; msPlayed: number; context?: string },
): Promise<void> {
  await db.insert(playHistory).values({
    userId,
    trackId: play.trackId,
    msPlayed: play.msPlayed,
    context: play.context ?? null,
  });
}

/** Distinct tracks, most recently played first. */
export async function recentTracks(db: Db, userId: string, limit: number): Promise<Track[]> {
  const lastPlays = db
    .select({
      trackId: playHistory.trackId,
      lastPlayedAt: max(playHistory.playedAt).as('last_played_at'),
    })
    .from(playHistory)
    .where(eq(playHistory.userId, userId))
    .groupBy(playHistory.trackId)
    .as('last_plays');
  const rows = await db
    .select({ track: tracks.data })
    .from(lastPlays)
    .innerJoin(tracks, eq(tracks.id, lastPlays.trackId))
    .orderBy(desc(lastPlays.lastPlayedAt), desc(tracks.id))
    .limit(limit);
  return rows.map((row) => row.track);
}
```

- [ ] **Step 4: Implement the routes**

`packages/api/src/routes/following.ts`:
```ts
import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { follow, listFollowing, unfollow } from '../library/following';
import { validate } from '../validation';

const artistParam = validate('param', z.object({ artistId: EntityIdSchema }));

export function followingRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .get('/me/following', async (c) => c.json(await listFollowing(db, c.get('user').id)))
    .put('/me/following/:artistId', artistParam, async (c) => {
      const artist = await catalog.getArtist(c.req.valid('param').artistId);
      await follow(db, c.get('user').id, artist);
      return c.body(null, 204);
    })
    .delete('/me/following/:artistId', artistParam, async (c) => {
      await unfollow(db, c.get('user').id, c.req.valid('param').artistId);
      return c.body(null, 204);
    });
}
```

`packages/api/src/routes/history.ts`:
```ts
import { EntityIdSchema } from '@riff/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { recentTracks, recordPlay } from '../library/history';
import { saveTrackSnapshot } from '../library/snapshots';
import { limitParam, validate } from '../validation';

const DAY_MS = 86_400_000;

export function historyRoutes({ db, catalog }: Pick<AppDeps, 'db' | 'catalog'>) {
  return new Hono<AppEnv>()
    .post(
      '/me/history',
      validate(
        'json',
        z.object({
          trackId: EntityIdSchema,
          msPlayed: z.number().int().min(0).max(DAY_MS),
          context: z.string().trim().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const play = c.req.valid('json');
        const track = await saveTrackSnapshot(db, catalog, play.trackId);
        await recordPlay(db, c.get('user').id, { ...play, trackId: track.id });
        return c.body(null, 204);
      },
    )
    .get(
      '/me/history/recent',
      validate('query', z.object({ limit: limitParam(50, 20) })),
      async (c) => c.json(await recentTracks(db, c.get('user').id, c.req.valid('query').limit)),
    );
}
```

`packages/api/src/app.ts`:
```ts
import { followingRoutes } from './routes/following';
import { historyRoutes } from './routes/history';
```
```ts
    .route('/', playlistRoutes(deps))
    .route('/', followingRoutes(deps))
    .route('/', historyRoutes(deps));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/api test && pnpm --filter @riff/api typecheck`
Expected: PASS (98 tests) and a clean typecheck.

- [ ] **Step 6: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add packages/api
git commit -m "feat(api): add followed artists and play history"
```

---

### Task 7: Home

**Files:**
- Create: `packages/api/src/library/home.ts`, `packages/api/src/routes/home.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/src/routes/home.test.ts`

**Interfaces:**
- Consumes: `recentTracks` and `listFollowing` from Task 6; `reportError` and `AppDeps` from Task 2; `DEFAULT_HOME_GENRES` from `@riff/core`; `catalog.trending` and `catalog.getArtistTracks`.
- Produces:
  - `interface Home { recentlyPlayed: Track[]; topGenres: { genre: string; tracks: Track[] }[]; fromFollowed: Track[]; trending: Track[] }`
  - `composeHome(deps, userId): Promise<Home>` and `HOME_LIMITS`.
  - `GET /home` returns `Home` with `no-store`.

Composition (spec §6, with one agreed extension):
- **recentlyPlayed:** `recentTracks(…, 12)`.
- **topGenres:**
  - Take the 3 most frequent non-empty genres over the user's last 200 plays plus all their likes.
  - If fewer than 3, top up from `DEFAULT_HOME_GENRES` in order. The spec only covers "no history"; topping up also covers a user with one or two genres. Task 8 aligns the spec text.
  - Each genre gets `trending({ genre, limit: 12 })`, and genres with no tracks are dropped.
- **fromFollowed:** the 10 most recently followed artists, 5 tracks each, merged. Duplicates are dropped, the result is sorted by `releaseDate` descending (undated last), and capped at 20. One artist failing only drops that artist and reports through `onError`.
- **trending:** `trending({ limit: 20 })`.
- **Failures:** the four sections are built in parallel. A section that throws comes back empty and is reported through `onError`.
- **Sorting:** only our own merged array is sorted, never an array the catalog returned.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routes/home.test.ts`:
```ts
import { CatalogError } from '@riff/catalog';
import { DEFAULT_HOME_GENRES } from '@riff/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { okSources } from '../testing/fake-catalog';
import { makeArtist, makeTrack } from '../testing/fixtures';
import { setupApi, type TestUser } from '../testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.trending.mockImplementation(async ({ genre }) => ({
    tracks: [makeTrack(`trend-${genre ?? 'all'}`)],
    sources: okSources,
  }));
});

const ids = (list: { id: string }[]) => list.map((track) => track.id);
const home = async (user: TestUser) => {
  const res = await user.get('/home');
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return res.json();
};

describe('GET /home', () => {
  test('a new user gets the default genres and global trending', async () => {
    const body = await home(alice);
    expect(body.recentlyPlayed).toEqual([]);
    expect(body.fromFollowed).toEqual([]);
    expect(body.topGenres.map((shelf: { genre: string }) => shelf.genre)).toEqual([
      ...DEFAULT_HOME_GENRES,
    ]);
    expect(ids(body.topGenres[0].tracks)).toEqual(['audius:ttrend-Electronic']);
    expect(ids(body.trending)).toEqual(['audius:ttrend-all']);
    expect(api.catalog.trending).toHaveBeenCalledWith({ genre: 'Electronic', limit: 12 });
    expect(api.catalog.trending).toHaveBeenCalledWith({ limit: 20 });
  });

  test('ranks genres by plays plus likes, then tops up with defaults', async () => {
    api.catalog.addTracks(
      makeTrack('h1', { genre: 'House' }),
      makeTrack('h2', { genre: 'House' }),
      makeTrack('t1', { genre: 'Techno' }),
      makeTrack('n1'),
    );
    await alice.post('/me/history', { trackId: 'audius:th1', msPlayed: 30_000 });
    await alice.post('/me/history', { trackId: 'audius:th1', msPlayed: 30_000 });
    await alice.put('/me/likes/audius:th2');
    await alice.put('/me/likes/audius:tt1');
    await alice.post('/me/history', { trackId: 'audius:tn1', msPlayed: 30_000 });

    const body = await home(alice);
    expect(body.topGenres.map((shelf: { genre: string }) => shelf.genre)).toEqual([
      'House',
      'Techno',
      'Electronic',
    ]);
    expect(ids(body.recentlyPlayed)).toEqual(expect.arrayContaining(['audius:th1', 'audius:tn1']));
    expect(body.recentlyPlayed).toHaveLength(2);
  });

  test('a genre with no trending tracks is left out', async () => {
    api.catalog.trending.mockImplementation(async ({ genre }) => ({
      tracks: genre === 'Lo-Fi' ? [] : [makeTrack(`trend-${genre ?? 'all'}`)],
      sources: okSources,
    }));
    const body = await home(alice);
    expect(body.topGenres.map((shelf: { genre: string }) => shelf.genre)).toEqual([
      'Electronic',
      'Hip-Hop/Rap',
    ]);
  });

  test('fromFollowed merges followed artists’ tracks newest first, without duplicates', async () => {
    api.catalog.addArtists(makeArtist(1), makeArtist(2), makeArtist(3));
    api.catalog.setArtistTracks('audius:a1', [
      makeTrack('old', { releaseDate: '2020-01-01' }),
      makeTrack('shared', { releaseDate: '2024-06-01' }),
    ]);
    api.catalog.setArtistTracks('audius:a2', [
      makeTrack('new', { releaseDate: '2025-03-01' }),
      makeTrack('shared', { releaseDate: '2024-06-01' }),
      makeTrack('undated'),
    ]);
    await alice.put('/me/following/audius:a1');
    await alice.put('/me/following/audius:a2');
    await alice.put('/me/following/audius:a3');
    api.catalog.getArtistTracks.mockImplementationOnce(async () => {
      throw new CatalogError('UPSTREAM_ERROR', 'down');
    });

    const body = await home(alice);
    expect(ids(body.fromFollowed)).toEqual([
      'audius:tnew',
      'audius:tshared',
      'audius:told',
      'audius:tundated',
    ]);
    expect(api.errors).toHaveLength(1);
  });

  test('a failing section comes back empty and the rest still render', async () => {
    api.catalog.addTracks(makeTrack(1));
    await alice.post('/me/history', { trackId: 'audius:t1', msPlayed: 30_000 });
    api.catalog.trending.mockRejectedValue(new CatalogError('UPSTREAM_TIMEOUT', 'slow'));

    const body = await home(alice);
    expect(body.trending).toEqual([]);
    expect(body.topGenres).toEqual([]);
    expect(ids(body.recentlyPlayed)).toEqual(['audius:t1']);
    expect(api.errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @riff/api exec vitest run src/routes/home.test.ts`
Expected: FAIL, with `expected 404 to be 200`.

- [ ] **Step 3: Implement**

`packages/api/src/library/home.ts`:
```ts
import { DEFAULT_HOME_GENRES, type Track } from '@riff/core';
import { type Db, likedTracks, playHistory, tracks } from '@riff/db';
import { sql } from 'drizzle-orm';
import { type AppDeps, reportError } from '../deps';
import { listFollowing } from './following';
import { recentTracks } from './history';

export const HOME_LIMITS = {
  recentlyPlayed: 12,
  genres: 3,
  /** History rows considered when ranking genres (likes are always all counted). */
  genreHistoryWindow: 200,
  tracksPerGenre: 12,
  followedArtists: 10,
  tracksPerArtist: 5,
  fromFollowed: 20,
  trending: 20,
} as const;

export interface Home {
  recentlyPlayed: Track[];
  topGenres: { genre: string; tracks: Track[] }[];
  fromFollowed: Track[];
  trending: Track[];
}

type HomeDeps = Pick<AppDeps, 'db' | 'catalog' | 'onError'>;

/** Builds the four sections in parallel; a section that fails is returned empty. */
export async function composeHome(deps: HomeDeps, userId: string): Promise<Home> {
  const section = async <T>(name: string, fallback: T, load: () => Promise<T>): Promise<T> => {
    try {
      return await load();
    } catch (error) {
      reportError(deps, error, `home.${name}`);
      return fallback;
    }
  };

  const [recentlyPlayed, topGenres, fromFollowed, trending] = await Promise.all([
    section('recentlyPlayed', [], () => recentTracks(deps.db, userId, HOME_LIMITS.recentlyPlayed)),
    section('topGenres', [], () => genreShelves(deps, userId)),
    section('fromFollowed', [], () => newFromFollowed(deps, userId)),
    section('trending', [], async () => {
      const result = await deps.catalog.trending({ limit: HOME_LIMITS.trending });
      return result.tracks;
    }),
  ]);
  return { recentlyPlayed, topGenres, fromFollowed, trending };
}

/**
 * The user's most frequent genres over their last 200 plays plus all likes, topped up with the
 * default genres when there are fewer than three.
 */
async function topGenres(db: Db, userId: string): Promise<string[]> {
  const rows = await db.execute<{ genre: string }>(sql`
    with pool as (
      (select ${playHistory.trackId} as track_id from ${playHistory}
        where ${playHistory.userId} = ${userId}
        order by ${playHistory.playedAt} desc
        limit ${HOME_LIMITS.genreHistoryWindow})
      union all
      (select ${likedTracks.trackId} from ${likedTracks} where ${likedTracks.userId} = ${userId})
    )
    select ${tracks.data}->>'genre' as genre
    from pool join ${tracks} on ${tracks.id} = pool.track_id
    where coalesce(${tracks.data}->>'genre', '') <> ''
    group by 1
    order by count(*) desc, 1
    limit ${HOME_LIMITS.genres}
  `);
  const genres = rows.map((row) => row.genre);
  for (const genre of DEFAULT_HOME_GENRES) {
    if (genres.length >= HOME_LIMITS.genres) break;
    if (!genres.includes(genre)) genres.push(genre);
  }
  return genres;
}

async function genreShelves(deps: HomeDeps, userId: string): Promise<Home['topGenres']> {
  const genres = await topGenres(deps.db, userId);
  const shelves = await Promise.all(
    genres.map(async (genre) => {
      const { tracks } = await deps.catalog.trending({ genre, limit: HOME_LIMITS.tracksPerGenre });
      return { genre, tracks };
    }),
  );
  return shelves.filter((shelf) => shelf.tracks.length > 0);
}

/** Newest tracks across the ten most recently followed artists. */
async function newFromFollowed(deps: HomeDeps, userId: string): Promise<Track[]> {
  const artists = await listFollowing(deps.db, userId, HOME_LIMITS.followedArtists);
  const lists = await Promise.allSettled(
    artists.map((artist) =>
      deps.catalog.getArtistTracks(artist.id, { limit: HOME_LIMITS.tracksPerArtist }),
    ),
  );
  const seen = new Set<string>();
  const merged: Track[] = [];
  for (const list of lists) {
    if (list.status === 'rejected') {
      reportError(deps, list.reason, 'home.fromFollowed');
      continue;
    }
    for (const track of list.value) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      merged.push(track);
    }
  }
  // `merged` is our own array; the tracks inside are shared cache objects and stay untouched.
  return merged
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    .slice(0, HOME_LIMITS.fromFollowed);
}
```

`packages/api/src/routes/home.ts`:
```ts
import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import type { AppDeps } from '../deps';
import { composeHome } from '../library/home';

export function homeRoutes(deps: Pick<AppDeps, 'db' | 'catalog' | 'onError'>) {
  return new Hono<AppEnv>().get('/home', async (c) =>
    c.json(await composeHome(deps, c.get('user').id)),
  );
}
```

`packages/api/src/app.ts`:
```ts
import { homeRoutes } from './routes/home';
```
```ts
    .route('/', historyRoutes(deps))
    .route('/', homeRoutes(deps));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/api test && pnpm --filter @riff/api typecheck`
Expected: PASS (103 tests) and a clean typecheck.

- [ ] **Step 5: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add packages/api
git commit -m "feat(api): compose the home screen from history, likes, follows and trending"
```

---

### Task 8: Env wiring, typed client, live checks and docs

**Files:**
- Create: `packages/api/src/config.ts`, `packages/api/src/client.ts`, `README.md`
- Modify: `packages/api/src/index.ts`, `CLAUDE.md`, `.env.example`, `docs/superpowers/specs/2026-09-27-riff-v1-design.md`
- Test: `packages/api/src/config.test.ts`, `packages/api/src/client.test.ts`, `packages/api/src/live.test.ts`

**Interfaces:**
- Consumes: everything above; `createCatalog` and `catalogConfigFromEnv` from Plan 1.
- Produces:
  - `apiConfigFromEnv(env): ApiConfig`. It reads `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), `BETTER_AUTH_URL` and `ALLOW_SIGNUPS` (`true`/`false`, default `true`; blank means unset), plus the catalog env. Errors name the variables but never their values.
  - `createApiFromEnv(env): { app, auth, close }`. Plan 3 calls it once at module scope in the Next.js route handler.
  - `@riff/api/client`: `createApiClient(baseUrl, options?)`, which is `hc<AppType>`, plus `type ApiClient` and `type AppType`.
  - The final `@riff/api` exports, including the response types `Home`, `LikesPage`, `LikedTrack`, `PlaylistSummary`, `PlaylistDetail` and `PlaylistEntry`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/config.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { apiConfigFromEnv, createApiFromEnv } from './config';

const env = {
  DATABASE_URL: 'postgres://riff:riff@localhost:5432/riff',
  BETTER_AUTH_SECRET: 's'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
};

describe('apiConfigFromEnv', () => {
  test('reads the env with sign-ups allowed by default', () => {
    expect(apiConfigFromEnv(env)).toMatchObject({
      databaseUrl: env.DATABASE_URL,
      authUrl: 'http://localhost:3000',
      allowSignups: true,
      catalog: { jamendo: null },
    });
  });

  test('ALLOW_SIGNUPS=false closes sign-ups; blank means the default', () => {
    expect(apiConfigFromEnv({ ...env, ALLOW_SIGNUPS: 'false' }).allowSignups).toBe(false);
    expect(apiConfigFromEnv({ ...env, ALLOW_SIGNUPS: '' }).allowSignups).toBe(true);
  });

  test('names every problem without echoing secrets', () => {
    const attempt = () =>
      apiConfigFromEnv({ BETTER_AUTH_SECRET: 'replace-me', BETTER_AUTH_URL: 'not a url' });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).toThrow(/BETTER_AUTH_SECRET must be at least 32 characters/);
    expect(attempt).toThrow(/BETTER_AUTH_URL/);
    expect(attempt).not.toThrow(/replace-me/);
  });

  test('rejects ALLOW_SIGNUPS values other than true/false', () => {
    expect(() => apiConfigFromEnv({ ...env, ALLOW_SIGNUPS: 'no' })).toThrow(/ALLOW_SIGNUPS/);
  });
});

test('createApiFromEnv builds a working app without touching the database', async () => {
  const { app, close } = createApiFromEnv(env);
  const res = await app.request('/api/health');
  expect(await res.json()).toEqual({ ok: true });
  await close();
});
```

`packages/api/src/client.test.ts`. It is also a compile-time check: `pnpm typecheck` fails here if `AppType` stops inferring. This was verified: a misspelled `track.titel`, or a number passed as the `limit` query, is a type error.
```ts
import { beforeEach, expect, test } from 'vitest';
import { createApiClient } from './client';
import { makeTrack } from './testing/fixtures';
import { setupApi, type TestUser } from './testing/harness';

const api = setupApi();
let alice: TestUser;

beforeEach(async () => {
  alice = await api.signUp('alice');
  api.catalog.addTracks(makeTrack(1));
});

const client = (cookie?: string) =>
  createApiClient('http://localhost/api', {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => api.app.request(input, init),
    headers: cookie ? { cookie } : {},
  });

test('the typed client reaches public and session routes', async () => {
  const health = await client().health.$get();
  expect(await health.json()).toEqual({ ok: true });

  const signedIn = client(alice.cookie);
  const put = await signedIn.me.likes[':trackId'].$put({ param: { trackId: 'audius:t1' } });
  expect(put.status).toBe(204);

  const likes = await signedIn.me.likes.$get({ query: {} });
  const page = await likes.json();
  // Typed access: a compile error here means AppType lost its inference.
  expect(page.items[0]?.track.title).toBe('Track 1');

  const search = await signedIn.search.$get({ query: { q: 'lofi', limit: '5' } });
  expect((await search.json()).sources.audius).toBe('ok');
});
```

`packages/api/src/live.test.ts`:
```ts
import { catalogConfigFromEnv, createCatalog } from '@riff/catalog';
import { TrackSchema } from '@riff/core';
import { createTestDb, truncateAll } from '@riff/db/testing';
import { afterAll, describe, expect, test } from 'vitest';
import { createApp } from './app';
import { createAuth } from './auth';

// The whole API against the real upstreams and riff_test.
// Run with: set -a && . ./.env && set +a && pnpm --filter @riff/api test:live
describe.skipIf(!process.env.LIVE)('live API', { timeout: 60_000 }, () => {
  const { db, close } = createTestDb();
  const auth = createAuth({
    db,
    secret: 'riff-live-test-secret-4f0c9a2e7b1d3856',
    baseURL: 'http://localhost:3000',
    allowSignups: true,
  });
  const app = createApp({ db, catalog: createCatalog(catalogConfigFromEnv(process.env)), auth });
  afterAll(() => close());

  test('sign up, search, stream, like, record a play, see it on home', async () => {
    await truncateAll(db);
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Live',
        email: 'live@example.com',
        password: 'live-test-pw-123',
      }),
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const get = (path: string) => app.request(`/api${path}`, { headers: { cookie } });
    const send = (method: string, path: string, body?: unknown) =>
      app.request(`/api${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const search = await (await get('/search?q=lofi&limit=5')).json();
    expect(search.sources.audius).toBe('ok');
    const track = TrackSchema.parse(search.tracks[0]);

    const stream = await (await get(`/stream/${track.id}?format=json`)).json();
    expect(stream.url).toMatch(/^https:\/\//);

    expect((await send('PUT', `/me/likes/${track.id}`)).status).toBe(204);
    const likes = await (await get('/me/likes')).json();
    expect(likes.items[0].track.id).toBe(track.id);

    expect(
      (await send('POST', '/me/history', { trackId: track.id, msPlayed: 30_000 })).status,
    ).toBe(204);
    const home = await (await get('/home')).json();
    expect(home.recentlyPlayed[0].id).toBe(track.id);
    expect(home.trending.length).toBeGreaterThan(0);

    await truncateAll(db);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @riff/api exec vitest run src/config.test.ts src/client.test.ts`
Expected: FAIL, because `./config` and `./client` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/api/src/config.ts`:
```ts
import { type CatalogConfig, catalogConfigFromEnv, createCatalog } from '@riff/catalog';
import { createDb } from '@riff/db';
import { z } from 'zod';
import { createApp } from './app';
import { createAuth } from './auth';

export interface ApiConfig {
  databaseUrl: string;
  authSecret: string;
  authUrl: string;
  allowSignups: boolean;
  catalog: CatalogConfig;
}

type Env = Readonly<Record<string, string | undefined>>;

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  ALLOW_SIGNUPS: z.enum(['true', 'false']).default('true'),
});

/** Reads and validates the API's env vars. Errors name the variables, never their values. */
export function apiConfigFromEnv(env: Env): ApiConfig {
  // Blank values (`ALLOW_SIGNUPS=`) count as unset.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new Error(`Invalid API environment: ${problems.join('; ')}`);
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    authSecret: parsed.data.BETTER_AUTH_SECRET,
    authUrl: parsed.data.BETTER_AUTH_URL,
    allowSignups: parsed.data.ALLOW_SIGNUPS === 'true',
    catalog: catalogConfigFromEnv(env),
  };
}

/** Wires db, catalog and auth from env vars. Call once per process (module scope in Next.js). */
export function createApiFromEnv(env: Env) {
  const config = apiConfigFromEnv(env);
  const { db, close } = createDb(config.databaseUrl);
  const catalog = createCatalog(config.catalog);
  const auth = createAuth({
    db,
    secret: config.authSecret,
    baseURL: config.authUrl,
    allowSignups: config.allowSignups,
  });
  return { app: createApp({ db, catalog, auth }), auth, close };
}
```

`packages/api/src/client.ts`:
```ts
import { type ClientRequestOptions, hc } from 'hono/client';
import type { AppType } from './app';

export type { AppType };

/** Typed API client. `baseUrl` points at the API root, e.g. `/api` in the web app. */
export const createApiClient = (baseUrl: string, options?: ClientRequestOptions) =>
  hc<AppType>(baseUrl, options);

export type ApiClient = ReturnType<typeof createApiClient>;
```

`packages/api/src/index.ts` (final):
```ts
export { type AppType, apiRoutes, createApp } from './app';
export { type AppEnv, type Auth, type AuthOptions, createAuth, type SessionUser } from './auth';
export { type ApiConfig, apiConfigFromEnv, createApiFromEnv } from './config';
export type { AppDeps } from './deps';
export { ApiError, type ErrorBody, type ErrorCode } from './errors';
export type { Home } from './library/home';
export type { LikedTrack, LikesPage } from './library/likes';
export type { PlaylistDetail, PlaylistEntry, PlaylistSummary } from './library/playlists';
```

- [ ] **Step 4: Run all checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: every Turbo task passes:
- core: 60 tests
- catalog: 80 tests, 5 skipped
- db: 8 tests
- api: 109 tests, 1 skipped

Run: `set -a && . ./.env && set +a && pnpm --filter @riff/api test:live`
Expected: PASS (1 test) against real Audius and `riff_test`.

- [ ] **Step 5: Update the docs**

`CLAUDE.md`: replace everything above the `<!-- dgc-policy-v11 -->` line with the text below. Leave the dual-graph policy below that line untouched.
```markdown
# Riff: project guide

A free, Spotify-like music app used as a personal daily driver (web now, Expo mobile later).
Uses legal sources only: Audius (primary, no key), Jamendo (optional key), Radio Browser, and LRCLIB lyrics.
Never add YouTube-scraping sources.

- Spec: `docs/superpowers/specs/2026-09-27-riff-v1-design.md`
- Plans: `docs/superpowers/plans/`. Plans 1 (foundation) and 2 (db + api) are done; Plan 3 (web) is next.

## Layout
- `packages/core`: domain types + zod schemas, entity ids, LRC parser, and the queue state machine (exported as `queue`). Pure: no I/O; randomness and ids are injected via `QueueEnv`.
- `packages/catalog`: source adapters (`src/sources/*`), the aggregator (fan-out, cross-source dedupe, cache), and the LRCLIB client. Uses Web APIs only; no `node:` imports outside tests.
- `packages/db`: Drizzle schema (`src/schema/app.ts`; `src/schema/auth.ts` is generated by the Better Auth CLI), SQL migrations in `migrations/`, `createDb`, and `@riff/db/testing` (test-DB guard, migrate, truncate).
- `packages/api`: the Hono app mounted at `/api` (`createApp`, `createApiFromEnv`), Better Auth at `/api/auth/*`, catalog routes, and library routes (`src/routes/*`) over DB queries (`src/library/*`). `@riff/api/client` exports the typed `hc` client; `AppType` paths are relative to `/api`. Web APIs only; no `node:` imports outside tests.
- Coming in Plan 3: `apps/web` (Next.js, which mounts the API at `/api`).

## Commands (from the repo root)
- `pnpm install`
- `pnpm test`: all tests via Turbo. The db and api tests use `DATABASE_URL_TEST`, read from the environment or the root `.env`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`
- `pnpm db:generate`: writes a migration for schema changes. For hand-written SQL: `pnpm --filter @riff/db exec drizzle-kit generate --custom --name=<name>`.
- `pnpm db:migrate`: applies migrations to `DATABASE_URL`. In production, use Neon's direct (non-pooled) URL: the migrator holds a session-level advisory lock.
- `set -a && . ./.env && set +a && pnpm --filter @riff/catalog test:live`: checks the real upstream APIs
- `set -a && . ./.env && set +a && pnpm --filter @riff/api test:live`: runs the whole API against the real upstreams and `riff_test`

## Conventions
- TypeScript is strict with `noUncheckedIndexedAccess`. Packages export TS source (`exports: ./src/index.ts`) and have no build step.
- Dependency versions are pinned once in `pnpm-workspace.yaml` under `catalog:`; reference them as `"catalog:"`.
- Entity ids look like `source:nativeId`: `audius:NQwXON0`, `jamendo:album:42`, `radio:<uuid>`. User playlist ids are UUIDs.
- Tests are Vitest files colocated as `*.test.ts`. Unit tests never touch the network; use `packages/catalog/src/testing/fake-fetch.ts`.
- DB and API tests run against `riff_test`. `@riff/db/testing` refuses any database whose name doesn't end in `_test`. API test files run one at a time (`fileParallelism: false`) because every test truncates the tables.
- API route tests use `setupApi()` from `packages/api/src/testing/harness.ts`. Its fake catalog deep-freezes its values: real catalog results are shared cache objects, so API code must never mutate them.
- API errors are always `{ error: { code, message } }` (`ApiError`, `toApiError`). Validate input with `validate()` from `src/validation.ts`. Better Auth's `/api/auth/*` responses keep Better Auth's own format.
- Drizzle renders columns unqualified in single-table selects. Correlated subqueries inside `sql` fragments must therefore use plain qualified SQL (see `summaryColumns` in `library/playlists.ts`).
- Playlist positions are fractional-index keys in a `COLLATE "C"` column. Never compare them under another collation.
- Generated files:
  - `packages/db/migrations/**` comes from drizzle-kit and is excluded from Biome.
  - `packages/db/src/schema/auth.ts` comes from the Better Auth CLI (`npx auth@<version> generate`). Regenerate it when upgrading better-auth.
- Upstream quirks:
  - Audius returns 400 (not 404) for unknown ids.
  - Audius trending windows are `week | month | allTime`.
  - Radio streams must be https and non-HLS.
- Local database: native Postgres 16, with role and databases `riff` / `riff_test` (password `riff`). Env vars live in the root `.env`; see `.env.example`.
```

`.env.example` (full file; only comments change, no values):
```bash
# --- Database (native Postgres 16; production uses Neon's pooled URL) ---
DATABASE_URL=postgres://riff:riff@localhost:5432/riff
# Tests truncate this database, so its name must end in _test.
DATABASE_URL_TEST=postgres://riff:riff@localhost:5432/riff_test

# --- Auth ---
# At least 32 characters. Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=replace-me
BETTER_AUTH_URL=http://localhost:3000
# Set to false once your account exists.
ALLOW_SIGNUPS=true

# --- Music sources ---
AUDIUS_API_URL=https://api.audius.co
AUDIUS_APP_NAME=riff
# Optional: free key from https://devportal.jamendo.com enables Jamendo
JAMENDO_CLIENT_ID=
# Comma-separated Radio Browser mirrors (empty disables radio)
RADIO_BROWSER_SERVERS=de1,de2
```

`README.md` (new; spec §12 refers to it for the database setup):
````markdown
# Riff

A free, Spotify-like music player for personal use. It streams only from legal, free sources:
Audius, Jamendo, Radio Browser and LRCLIB (lyrics).

## Local setup

Requirements: Node 24, pnpm 12 and PostgreSQL 16.

1. Create the database role and databases (once):

   ```bash
   sudo -u postgres psql \
     -c "CREATE ROLE riff LOGIN PASSWORD 'riff'" \
     -c "CREATE DATABASE riff OWNER riff" \
     -c "CREATE DATABASE riff_test OWNER riff"
   ```

2. Install dependencies: `pnpm install`
3. Configure: `cp .env.example .env`, then set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
4. Create the tables: `pnpm db:migrate`
5. Run the tests: `pnpm test`

The web app (`pnpm dev`) arrives with Plan 3. Design and plans live in `docs/superpowers/`.
````

`docs/superpowers/specs/2026-09-27-riff-v1-design.md`: align the text with what Plans 1 and 2 built. The first three edits are deviations the Plan 1 review accepted. Replace each "old" sentence with the "new" one:
1. §5 Adapter interface.
   - Old: "Adapters receive `{ fetch, config }` at construction time (fetch is injected so tests can use fixtures)."
   - New: "Adapters receive `{ http, config }` at construction time. `http` is an `HttpClient` over an injected `fetch`, so tests can use fixtures."
2. §5 Audius.
   - Old: "`resolveStream` calls `/tracks/{id}/stream?no_redirect=true`."
   - New: "`resolveStream` uses `stream.url` from the track JSON and falls back to `/tracks/{id}/stream?no_redirect=true`."
3. §8 Queue.
   - Old: "`selectors.upcoming(state)` returns"
   - New: "`queue.upcoming(state)` returns"
4. §6 Catalog table, the radio row. New: "`GET /radio/top?tag=` · `GET /radio/search?q=&tag=` | `Track[]` (live). `q` searches station names; `tag` alone lists that tag's top stations."
5. §6 Library table, the likes row. New: "`GET /me/likes?cursor=` | `{ items: { track, likedAt }[], nextCursor }`: liked tracks, newest first, 50 per page"
6. §6 Home composition, top genres.
   - Old: "With no history, use `['Electronic', 'Hip-Hop/Rap', 'Lo-Fi']`."
   - New: "With fewer than 3, top up from `['Electronic', 'Hip-Hop/Rap', 'Lo-Fi']`."
7. §6 Errors.
   - Old: "**Error body:** always `{ error: { code, message } }`."
   - New: "**Error body:** always `{ error: { code, message } }` (Better Auth's own `/api/auth/*` responses keep its format)."
8. §12 Production.
   - Old: "(`pnpm db:migrate` with the Neon URL)"
   - New: "(`pnpm db:migrate` with Neon's direct, non-pooled URL)"

- [ ] **Step 6: Format, lint, commit**

```bash
pnpm format && pnpm lint
git add packages/api CLAUDE.md README.md .env.example docs/superpowers/specs/2026-09-27-riff-v1-design.md
git commit -m "feat(api): wire the API from env, add the typed client and live checks; update docs"
```

---

## Handoff to Plan 3 (web)

Plan 3 starts from these facts:
- **Mounting.** Mount the API with `app/api/[[...route]]/route.ts`: `const { app } = createApiFromEnv(process.env)` at module scope, then `export const GET = handle(app)` (plus `POST`, `PUT`, `PATCH` and `DELETE`) via `hono/vercel`. The app already carries the `/api` base path.
- **Typed client.** The browser client is `createApiClient('/api')` from `@riff/api/client`. Better Auth's own client (`better-auth/react`) needs `basePath: '/api/auth'`.
- **Turbo env.** Turbo's strict env mode hides undeclared variables. For the `dev` and `build` tasks, declare the runtime env vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOW_SIGNUPS`, `AUDIUS_API_URL`, `AUDIUS_APP_NAME`, `JAMENDO_CLIENT_ID` and `RADIO_BROWSER_SERVERS`.
- **Auth failures.** A 401 body is `{ error: { code: 'UNAUTHORIZED' } }`. With `ALLOW_SIGNUPS=false`, sign-up returns Better Auth's `EMAIL_PASSWORD_SIGN_UP_DISABLED`.
- **Carried over from the Plan 1 review:**
  - The queue's `env.uid` must be `crypto.randomUUID()`.
  - Check that Next.js 16 works with TypeScript 7; fall back to `typescript@6.0.3` in `apps/web` only if needed.
  - Next 16's middleware file is `proxy.ts`.
