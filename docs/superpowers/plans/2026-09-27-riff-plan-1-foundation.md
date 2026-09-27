# Riff Plan 1 — Foundation (monorepo, core, catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm/Turborepo monorepo and ship two tested packages. `@riff/core` holds the domain types, entity ids, the LRC parser and the pure queue state machine. `@riff/catalog` holds the Audius/Jamendo/Radio Browser adapters, the LRCLIB client, and an aggregator with fan-out, merge and cache.

**Architecture:** Packages export TypeScript source directly (`exports: ./src/index.ts`) and have no build step. Next.js (Plan 3) transpiles them, and Vitest runs them as-is. `core` is pure: randomness and ids are injected. `catalog` uses only Web APIs (`fetch`, `URL`, `AbortSignal`), so it runs on Node, Bun or Workers, and it receives `fetch` by injection so unit tests never touch the network. One live test suite (`LIVE=1`) checks the real upstreams.

**Tech Stack:** Node 24, pnpm 12.6.0 workspaces + catalogs, Turborepo 2.11.4, TypeScript 7.0.2 (strict), zod 4.6.5, Vitest 5.0.2, Biome 2.5.14.

**Spec:** `docs/superpowers/specs/2026-09-27-riff-v1-design.md` (§2 sources, §4 domain model, §5 catalog, §8 queue). Plans 2 (db + api) and 3 (web) follow and build on the interfaces this plan produces.

## Global Constraints

- Node `>=24`; `packageManager` is `pnpm@12.6.0`. Versions are pinned once in `pnpm-workspace.yaml` under `catalog:`, and packages reference them as `"catalog:"`.
- TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`. Use `import type` for type-only imports.
- Every workspace package: `"type": "module"`, `"private": true`, `"exports": { ".": "./src/index.ts" }`, scripts `test` (`vitest run`) and `typecheck` (`tsc --noEmit`).
- `packages/core` performs no I/O and never calls `Math.random`, `Date.now` or `crypto` directly. It receives them through `QueueEnv`.
- `packages/catalog` never imports `node:*` outside `*.test.ts`. Unit tests use `src/testing/fake-fetch.ts` and never hit the network.
- Entity ids are `source:nativeId` with source ∈ `audius | jamendo | radio`. Examples: `audius:NQwXON0`, `jamendo:1886257`, `jamendo:album:404149`, `radio:<uuid>`.
- Audius: send `app_name` on every request. Unknown ids return HTTP **400** (`invalid trackId`); treat 400/404 on single-entity reads as not-found. Trending `time` ∈ `week | month | allTime`. Drop tracks that are `is_stream_gated`, `is_delete`, or `is_streamable === false`.
- Radio: keep only stations with `lastcheckok === 1`, `hls === 0`, and an `https://` `url_resolved` that is not `.m3u8`. Default servers are `de1,de2`.
- Timeouts: 3000 ms per source for fan-out (search, trending); 8000 ms for single-entity calls.
- Cache TTLs: search 5 min, trending 10 min, entities 1 h, lyrics found 24 h, lyrics missing 6 h. Any result with an `error`/`timeout` source is cached for 30 s only. Stream URLs are never cached.
- Outbound `User-Agent`: `Riff/0.1 (personal music player)`.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Search text with Unicode and URL-special characters** (`AC/DC & Beyoncé`) must reach upstreams exactly as typed. Pinned in Task 8 (`searchTracks encodes the query…`).
2. **Upstream items with missing or odd metadata** (null artwork, empty genre, `bpm: 0`, string/empty durations, blank titles) must still map to schema-valid `Track`s. Pinned in Task 8 (`tolerates missing optional metadata`) and Task 9 (`handles string and empty durations…`).
3. **The same track twice in a queue**: every queue operation targets `uid`, never the track id. Pinned in Task 4 (`gives duplicate tracks distinct uids`) and Task 5 (`removes a queued item by uid, leaving a duplicate…`).
4. **Whitespace-only or differently-cased queries** must not hit upstreams, and must share a cache entry. Pinned in Task 12 (`blank queries return empty…`, `normalises the cache key…`).
5. **Real-world LRC files** (CRLF endings, word-level `<mm:ss.xx>` tags, several timestamps on one line) must parse cleanly. Pinned in Task 3.

---

## File Structure

```
package.json                      root scripts (turbo), devDeps: turbo, biome
pnpm-workspace.yaml               workspaces + version catalog
turbo.json                        task graph
tsconfig.base.json                shared compiler options
biome.json                        lint + format
.nvmrc                            24
.env.example                      documented env vars (committed)
.env                              local values (git-ignored)
CLAUDE.md                         project guide (Task 13) + existing dual-graph policy
packages/core/
  src/ids.ts                      SourceId, EntityId, make/parse/isEntityId
  src/types.ts                    zod schemas + inferred domain types
  src/genres.ts                   GENRES, DEFAULT_HOME_GENRES
  src/lyrics.ts                   parseLrc, findActiveLineIndex
  src/queue/types.ts              QueueState & friends
  src/queue/shuffle.ts            shuffled (Fisher–Yates, injected rng)
  src/queue/queue.ts              pure queue transitions
  src/queue/test-helpers.ts       deterministic env + track factories (tests only)
  src/index.ts                    public exports (queue exported as namespace `queue`)
packages/catalog/
  src/errors.ts                   CatalogError
  src/cache.ts                    Cache interface + in-memory LRU/TTL/single-flight
  src/http.ts                     HttpClient (JSON GET, error mapping)
  src/testing/fake-fetch.ts       fetch double for unit tests
  src/adapter.ts                  SourceAdapter / RadioAdapter interfaces
  src/sources/audius/{types,map,adapter,fixtures}.ts (+ tests)
  src/sources/jamendo/{types,map,adapter,fixtures}.ts (+ tests)
  src/sources/radio/{types,map,adapter,fixtures}.ts (+ tests)
  src/lyrics/lrclib.ts            LyricsClient over LRCLIB (+ test)
  src/merge.ts                    interleave, normalizeForMatch, dedupeAcrossSources
  src/aggregator.ts               Catalog implementation
  src/create-catalog.ts           env → config → wired Catalog
  src/live.test.ts                real-upstream checks (LIVE=1 only)
  src/index.ts                    public exports
```

---

### Task 1: Monorepo scaffold + entity ids

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.nvmrc`, `.env.example`, `.env` (untracked)
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/ids.ts`
- Test: `packages/core/src/ids.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`@riff/core`): `SOURCE_IDS: readonly ['audius','jamendo','radio']`, `type SourceId`, ``type EntityId = `${SourceId}:${string}` ``, `isSourceId(v: string): v is SourceId`, `makeEntityId(source: SourceId, nativeId: string | number): EntityId`, `parseEntityId(v: string): { source: SourceId; nativeId: string } | null`, `isEntityId(v: string): v is EntityId`.

- [ ] **Step 1: Create root config files**

`package.json`:
```json
{
  "name": "riff",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.6.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "biome check .",
    "format": "biome check --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.14",
    "turbo": "2.11.4"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*

catalog:
  '@types/node': 24.19.0
  typescript: 7.0.2
  vitest: 5.0.2
  zod: 4.6.5
```

`turbo.json`:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "outputs": [] },
    "typecheck": { "outputs": [] }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single" } },
  "linter": {
    "enabled": true,
    "rules": { "preset": "recommended", "style": { "noNonNullAssertion": "off" } }
  },
  "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
}
```

`.nvmrc`:
```
24
```

`.env.example`:
```bash
# --- Database (native Postgres 16; production uses Neon's pooled URL) ---
DATABASE_URL=postgres://riff:riff@localhost:5432/riff
DATABASE_URL_TEST=postgres://riff:riff@localhost:5432/riff_test

# --- Auth ---
# Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=replace-me
BETTER_AUTH_URL=http://localhost:3000
ALLOW_SIGNUPS=true

# --- Music sources ---
AUDIUS_API_URL=https://api.audius.co
AUDIUS_APP_NAME=riff
# Optional: free key from https://devportal.jamendo.com enables Jamendo
JAMENDO_CLIENT_ID=
# Comma-separated Radio Browser mirrors (empty disables radio)
RADIO_BROWSER_SERVERS=de1,de2
```

- [ ] **Step 2: Create the local `.env` with a generated secret**

Run:
```bash
cp .env.example .env && sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" .env && grep -c '^BETTER_AUTH_SECRET=replace-me' .env
```
Expected: prints `0`, meaning the placeholder was replaced. `git status --short` must **not** list `.env`, because it is git-ignored.

- [ ] **Step 3: Create the `@riff/core` package shell**

`packages/core/package.json`:
```json
{
  "name": "@riff/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "catalog:" },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/core/src/index.ts`:
```ts
export * from './ids';
```

Run: `pnpm install`
Expected: completes and creates `pnpm-lock.yaml`.

- [ ] **Step 4: Write the failing test**

`packages/core/src/ids.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { isEntityId, makeEntityId, parseEntityId } from './ids';

describe('makeEntityId', () => {
  test('prefixes the native id with its source', () => {
    expect(makeEntityId('audius', 'NQwXON0')).toBe('audius:NQwXON0');
  });

  test('accepts numeric native ids', () => {
    expect(makeEntityId('jamendo', 1234)).toBe('jamendo:1234');
  });

  test('rejects empty native ids', () => {
    expect(() => makeEntityId('audius', '')).toThrow();
  });
});

describe('parseEntityId', () => {
  test('splits on the first colon only', () => {
    expect(parseEntityId('jamendo:album:42')).toEqual({ source: 'jamendo', nativeId: 'album:42' });
  });

  test('returns null for unknown sources, missing parts, or no colon', () => {
    expect(parseEntityId('spotify:abc')).toBeNull();
    expect(parseEntityId('audius:')).toBeNull();
    expect(parseEntityId(':abc')).toBeNull();
    expect(parseEntityId('abc')).toBeNull();
  });

  test('does not mistake user playlist UUIDs for entity ids', () => {
    expect(parseEntityId('3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f')).toBeNull();
  });
});

describe('isEntityId', () => {
  test('accepts valid ids and rejects others', () => {
    expect(isEntityId('radio:9617a958-0601-11e8-ae97-52543be04c81')).toBe(true);
    expect(isEntityId('nope')).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @riff/core exec vitest run src/ids.test.ts`
Expected: FAIL, because `./ids` cannot be resolved.

- [ ] **Step 6: Implement**

`packages/core/src/ids.ts`:
```ts
export const SOURCE_IDS = ['audius', 'jamendo', 'radio'] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

/** A source-namespaced id such as `audius:NQwXON0`. User playlists use UUIDs instead. */
export type EntityId = `${SourceId}:${string}`;

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

export function makeEntityId(source: SourceId, nativeId: string | number): EntityId {
  const id = String(nativeId);
  if (id.length === 0) throw new Error(`Empty native id for source "${source}"`);
  return `${source}:${id}`;
}

export function parseEntityId(value: string): { source: SourceId; nativeId: string } | null {
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  const source = value.slice(0, colon);
  const nativeId = value.slice(colon + 1);
  if (nativeId.length === 0 || !isSourceId(source)) return null;
  return { source, nativeId };
}

export function isEntityId(value: string): value is EntityId {
  return parseEntityId(value) !== null;
}
```

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm test && pnpm typecheck && pnpm format && pnpm lint`
Expected: Turbo runs `@riff/core#test` (6 passing) and `@riff/core#typecheck` with no errors, and `biome check` reports no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json biome.json .nvmrc .env.example packages/core
git commit -m "chore: scaffold pnpm/turbo monorepo with @riff/core entity ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain schemas and genres

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/genres.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/types.test.ts`, `packages/core/src/genres.test.ts`

**Interfaces:**
- Consumes: `SOURCE_IDS`, `isEntityId`, `EntityId` (Task 1).
- Produces: zod schemas `SourceIdSchema`, `EntityIdSchema`, `ArtworkSchema`, `ArtistRefSchema`, `TrackSchema`, `ArtistSchema`, `CollectionSchema`, `LyricLineSchema`, `LyricsSchema`, `StreamInfoSchema`, `TrendingWindowSchema`, `TRENDING_WINDOWS`. Also the inferred types `Artwork`, `ArtistRef`, `Track`, `Artist`, `Collection`, `LyricLine`, `Lyrics`, `StreamInfo`, `TrendingWindow`, and the constants `GENRES`, `type Genre`, `DEFAULT_HOME_GENRES`.
  - `Track = { id: EntityId; source: SourceId; title: string; artists: ArtistRef[]; album?: { id: EntityId; title: string }; durationSec: number | null; isLive: boolean; artwork: Artwork; genre?; mood?; bpm?; releaseDate?; playCount?; permalink? }`
  - `Collection.trackCount` is optional: some sources don't report it in search results.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/types.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import {
  CollectionSchema,
  EntityIdSchema,
  type Track,
  TrackSchema,
  TrendingWindowSchema,
} from './types';

const track: Track = {
  id: 'audius:abc',
  source: 'audius',
  title: 'Song',
  artists: [{ id: 'audius:u1', name: 'Artist' }],
  durationSec: 200,
  isLive: false,
  artwork: { md: 'https://img.test/480.jpg' },
};

describe('EntityIdSchema', () => {
  test('accepts source-prefixed ids and rejects everything else', () => {
    expect(EntityIdSchema.safeParse('audius:abc').success).toBe(true);
    expect(EntityIdSchema.safeParse('spotify:abc').success).toBe(false);
    expect(EntityIdSchema.safeParse(42).success).toBe(false);
  });
});

describe('TrackSchema', () => {
  test('accepts a regular track unchanged', () => {
    expect(TrackSchema.parse(track)).toEqual(track);
  });

  test('accepts a live track with a null duration and no artists', () => {
    const live: Track = {
      ...track,
      id: 'radio:uuid-1',
      source: 'radio',
      artists: [],
      durationSec: null,
      isLive: true,
    };
    expect(TrackSchema.safeParse(live).success).toBe(true);
  });

  test('rejects duration/live mismatches', () => {
    expect(TrackSchema.safeParse({ ...track, durationSec: null }).success).toBe(false);
    expect(TrackSchema.safeParse({ ...track, isLive: true }).success).toBe(false);
  });

  test('rejects an empty title', () => {
    expect(TrackSchema.safeParse({ ...track, title: '' }).success).toBe(false);
  });
});

describe('CollectionSchema', () => {
  test('accepts an album with tracks and no trackCount', () => {
    const album = {
      id: 'jamendo:album:7',
      source: 'jamendo',
      kind: 'album',
      title: 'LP',
      artwork: {},
      owner: { id: 'jamendo:9', name: 'Band' },
      tracks: [track],
    };
    expect(CollectionSchema.safeParse(album).success).toBe(true);
  });
});

describe('TrendingWindowSchema', () => {
  test('matches the windows Audius supports', () => {
    expect(TrendingWindowSchema.options).toEqual(['week', 'month', 'allTime']);
    expect(TrendingWindowSchema.safeParse('year').success).toBe(false);
  });
});
```

`packages/core/src/genres.test.ts`:
```ts
import { expect, test } from 'vitest';
import { DEFAULT_HOME_GENRES, GENRES } from './genres';

test('GENRES has no duplicates and uses Audius genre names', () => {
  expect(new Set(GENRES).size).toBe(GENRES.length);
  expect(GENRES).toContain('Lo-Fi');
  expect(GENRES).toContain('Hip-Hop/Rap');
});

test('home fallback genres are real genres', () => {
  for (const genre of DEFAULT_HOME_GENRES) expect(GENRES).toContain(genre);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @riff/core exec vitest run src/types.test.ts src/genres.test.ts`
Expected: FAIL, because `./types` and `./genres` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/core/src/types.ts`:
```ts
import { z } from 'zod';
import { type EntityId, isEntityId, SOURCE_IDS } from './ids';

export const SourceIdSchema = z.enum(SOURCE_IDS);

export const EntityIdSchema = z.custom<EntityId>(
  (value) => typeof value === 'string' && isEntityId(value),
  'Invalid entity id',
);

/** Roughly 150 / 480 / 1000 px square images. */
export const ArtworkSchema = z.object({
  sm: z.string().optional(),
  md: z.string().optional(),
  lg: z.string().optional(),
});
export type Artwork = z.infer<typeof ArtworkSchema>;

export const ArtistRefSchema = z.object({ id: EntityIdSchema, name: z.string() });
export type ArtistRef = z.infer<typeof ArtistRefSchema>;

export const TrackSchema = z
  .object({
    id: EntityIdSchema,
    source: SourceIdSchema,
    title: z.string().min(1),
    /** Primary artist first. Empty for radio stations. */
    artists: z.array(ArtistRefSchema),
    album: z.object({ id: EntityIdSchema, title: z.string() }).optional(),
    /** null exactly when the track is a live stream. */
    durationSec: z.number().nonnegative().nullable(),
    isLive: z.boolean(),
    artwork: ArtworkSchema,
    genre: z.string().optional(),
    mood: z.string().optional(),
    bpm: z.number().positive().optional(),
    releaseDate: z.string().optional(),
    playCount: z.number().int().nonnegative().optional(),
    /** Attribution link to the track's page on its source. */
    permalink: z.string().optional(),
  })
  .refine(
    (track) => (track.durationSec === null) === track.isLive,
    'durationSec must be null exactly when isLive is true',
  );
export type Track = z.infer<typeof TrackSchema>;

export const ArtistSchema = z.object({
  id: EntityIdSchema,
  source: SourceIdSchema,
  name: z.string(),
  handle: z.string().optional(),
  avatar: ArtworkSchema,
  banner: z.string().optional(),
  bio: z.string().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  trackCount: z.number().int().nonnegative().optional(),
  verified: z.boolean(),
});
export type Artist = z.infer<typeof ArtistSchema>;

/** A playlist or album that lives on a source (user playlists live in the DB). */
export const CollectionSchema = z.object({
  id: EntityIdSchema,
  source: SourceIdSchema,
  kind: z.enum(['playlist', 'album']),
  title: z.string(),
  description: z.string().optional(),
  artwork: ArtworkSchema,
  owner: ArtistRefSchema,
  trackCount: z.number().int().nonnegative().optional(),
  tracks: z.array(TrackSchema).optional(),
});
export type Collection = z.infer<typeof CollectionSchema>;

export const LyricLineSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  text: z.string(),
});
export type LyricLine = z.infer<typeof LyricLineSchema>;

export const LyricsSchema = z.object({
  synced: z.array(LyricLineSchema).nullable(),
  plain: z.string().nullable(),
  instrumental: z.boolean(),
});
export type Lyrics = z.infer<typeof LyricsSchema>;

export const StreamInfoSchema = z.object({
  url: z.string(),
  /** Alternate URLs for the same audio, tried in order when `url` fails. */
  mirrors: z.array(z.string()),
  live: z.boolean(),
});
export type StreamInfo = z.infer<typeof StreamInfoSchema>;

export const TRENDING_WINDOWS = ['week', 'month', 'allTime'] as const;
export const TrendingWindowSchema = z.enum(TRENDING_WINDOWS);
export type TrendingWindow = z.infer<typeof TrendingWindowSchema>;
```

`packages/core/src/genres.ts`:
```ts
/** Audius genre names; used verbatim as the trending `genre` filter. */
export const GENRES = [
  'Electronic',
  'Hip-Hop/Rap',
  'Pop',
  'Rock',
  'Alternative',
  'R&B/Soul',
  'Lo-Fi',
  'House',
  'Deep House',
  'Tech House',
  'Techno',
  'Trance',
  'Drum & Bass',
  'Dubstep',
  'Trap',
  'Future Bass',
  'Ambient',
  'Downtempo',
  'Experimental',
  'Jazz',
  'Funk',
  'Soundtrack',
  'Folk',
  'Acoustic',
  'Country',
  'Latin',
  'Reggae',
  'Dancehall',
  'World',
  'Classical',
  'Metal',
  'Punk',
  'Blues',
  'Hyperpop',
  'Disco',
  'Electro',
  'Jungle',
  'Hardstyle',
  'Moombahton',
  'Vaporwave',
] as const;

export type Genre = (typeof GENRES)[number];

/** Home-screen genres for a listener with no history yet. */
export const DEFAULT_HOME_GENRES: readonly Genre[] = ['Electronic', 'Hip-Hop/Rap', 'Lo-Fi'];
```

Replace `packages/core/src/index.ts`:
```ts
export * from './genres';
export * from './ids';
export * from './types';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/core test && pnpm --filter @riff/core typecheck`
Expected: PASS (all core tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add domain schemas, trending windows and genres

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: LRC parsing and active-line lookup

**Files:**
- Create: `packages/core/src/lyrics.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/lyrics.test.ts`

**Interfaces:**
- Consumes: `LyricLine` (Task 2).
- Produces:
  - `parseLrc(lrc: string): LyricLine[]`: sorted by `timeMs`; lines without timestamps are dropped; blank timed lines are kept, with text `''`.
  - `findActiveLineIndex(lines: readonly LyricLine[], positionMs: number): number`: the index of the last line with `timeMs <= positionMs`, or `-1`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/lyrics.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { findActiveLineIndex, parseLrc } from './lyrics';

describe('parseLrc', () => {
  test('parses 2- and 3-digit fractions and whole seconds', () => {
    expect(parseLrc('[00:30.75] One more time\n[01:02.123]Two\n[02:03]Three')).toEqual([
      { timeMs: 30_750, text: 'One more time' },
      { timeMs: 62_123, text: 'Two' },
      { timeMs: 123_000, text: 'Three' },
    ]);
  });

  test('expands lines with several timestamps and sorts by time', () => {
    expect(parseLrc('[00:10.00][00:05.00]Chorus\n[00:07.50]Verse')).toEqual([
      { timeMs: 5_000, text: 'Chorus' },
      { timeMs: 7_500, text: 'Verse' },
      { timeMs: 10_000, text: 'Chorus' },
    ]);
  });

  test('ignores metadata tags and untimed lines but keeps blank timed lines', () => {
    expect(parseLrc('[ar:Daft Punk]\n[ti:One More Time]\nno timestamp\n[00:33.18] ')).toEqual([
      { timeMs: 33_180, text: '' },
    ]);
  });

  test('handles CRLF line endings', () => {
    expect(parseLrc('[00:01.00]a\r\n[00:02.00]b\r\n')).toEqual([
      { timeMs: 1_000, text: 'a' },
      { timeMs: 2_000, text: 'b' },
    ]);
  });

  test('strips word-level timing tags', () => {
    expect(parseLrc('[00:01.00]<00:01.00>Hello <00:01.50>world')).toEqual([
      { timeMs: 1_000, text: 'Hello world' },
    ]);
  });

  test('returns an empty list for empty input', () => {
    expect(parseLrc('')).toEqual([]);
  });
});

describe('findActiveLineIndex', () => {
  const lines = [
    { timeMs: 1_000, text: 'a' },
    { timeMs: 2_000, text: 'b' },
    { timeMs: 3_000, text: 'c' },
  ];

  test('returns -1 before the first line', () => {
    expect(findActiveLineIndex(lines, 0)).toBe(-1);
  });

  test('returns the line that started most recently', () => {
    expect(findActiveLineIndex(lines, 1_000)).toBe(0);
    expect(findActiveLineIndex(lines, 2_999)).toBe(1);
    expect(findActiveLineIndex(lines, 99_999)).toBe(2);
  });

  test('returns -1 for no lines', () => {
    expect(findActiveLineIndex([], 500)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @riff/core exec vitest run src/lyrics.test.ts`
Expected: FAIL, because `./lyrics` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/core/src/lyrics.ts`:
```ts
import type { LyricLine } from './types';

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

/** Parses LRC text into time-sorted lines. Metadata tags and untimed lines are dropped. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIME_TAG)];
    if (stamps.length === 0) continue;
    const text = raw.replace(TIME_TAG, '').replace(WORD_TAG, '').trim();
    for (const [, minutes, seconds, fraction = '0'] of stamps) {
      const ms = Number(fraction.padEnd(3, '0'));
      lines.push({ timeMs: (Number(minutes) * 60 + Number(seconds)) * 1000 + ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the last line whose start is at or before `positionMs`; -1 if none. */
export function findActiveLineIndex(lines: readonly LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid] as LyricLine).timeMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
```

Replace `packages/core/src/index.ts`:
```ts
export * from './genres';
export * from './ids';
export * from './lyrics';
export * from './types';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/core test && pnpm --filter @riff/core typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): parse LRC lyrics and locate the active line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Queue state machine — playback navigation

**Files:**
- Create: `packages/core/src/queue/types.ts`, `packages/core/src/queue/shuffle.ts`, `packages/core/src/queue/queue.ts`, `packages/core/src/queue/test-helpers.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/queue/shuffle.test.ts`, `packages/core/src/queue/queue.navigation.test.ts`

**Interfaces:**
- Consumes: `Track` (Task 2).
- Produces:
  - Types: `RepeatMode = 'off'|'all'|'one'`; `QueueContextType`; `QueueContext { type; id?; name }`; `QueueItem { uid; track }`; `QueueState { context; original; order; index; upNext; current; currentFromUpNext; shuffle; repeat }`; `QueueEffect = 'play'|'restart'|'stop'|'none'`; `QueueStep { state; effect }`; `QueueEnv { rng(): number; uid(): string }`.
  - `shuffled<T>(items: readonly T[], rng: () => number): T[]`.
  - Namespace `queue` (exported from `@riff/core` as `export * as queue`), containing:
    - `emptyQueue` and `RESTART_THRESHOLD_SEC = 3`
    - `playContext(state, tracks, startIndex, context, env): QueueState`
    - `next(state, env): QueueStep`
    - `trackEnded(state, env): QueueStep`
    - `prev(state, positionSec): QueueStep`
    - `cycleRepeat(state): QueueState`
    - `upcoming(state): QueueItem[]`
    - `hasNext(state): boolean`
    - `addToQueue(state, tracks, env): QueueState`
    - `playNext(state, tracks, env): QueueState`

**Semantics** (from spec §8):
- The audio engine acts on `effect`:
  - `play`: load `state.current` and play it from 0.
  - `restart`: seek to 0 and play.
  - `stop`: reached the end; pause.
  - `none`: no-op.
- `index` always points at the last *context* item played. Queued (`upNext`) items never move it.

- [ ] **Step 1: Write the types and test helpers**

`packages/core/src/queue/types.ts`:
```ts
import type { Track } from '../types';

export type RepeatMode = 'off' | 'all' | 'one';

export type QueueContextType =
  | 'playlist'
  | 'collection'
  | 'artist'
  | 'liked'
  | 'search'
  | 'trending'
  | 'radio'
  | 'history';

export interface QueueContext {
  type: QueueContextType;
  id?: string;
  name: string;
}

/** `uid` distinguishes two entries of the same track. */
export interface QueueItem {
  uid: string;
  track: Track;
}

export interface QueueState {
  context: QueueContext | null;
  /** Context items in their original order. */
  original: QueueItem[];
  /** Play order: equal to `original` unless shuffled. */
  order: QueueItem[];
  /** Position in `order` of the last context item played; -1 before any. */
  index: number;
  /** User-queued items, played before the context continues. */
  upNext: QueueItem[];
  current: QueueItem | null;
  currentFromUpNext: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
}

/** What the audio engine must do after a transition. */
export type QueueEffect = 'play' | 'restart' | 'stop' | 'none';

export interface QueueStep {
  state: QueueState;
  effect: QueueEffect;
}

/** Injected so the state machine stays pure and deterministic under test. */
export interface QueueEnv {
  /** Returns a float in [0, 1). */
  rng: () => number;
  uid: () => string;
}
```

`packages/core/src/queue/test-helpers.ts`:
```ts
import type { Track } from '../types';
import type { QueueContext, QueueEnv, QueueItem } from './types';

export const ctx: QueueContext = { type: 'playlist', id: 'p1', name: 'Test playlist' };

export function track(n: number): Track {
  return {
    id: `audius:t${n}`,
    source: 'audius',
    title: `Track ${n}`,
    artists: [{ id: 'audius:a1', name: 'Artist' }],
    durationSec: 180,
    isLive: false,
    artwork: {},
  };
}

export const tracks = (count: number): Track[] =>
  Array.from({ length: count }, (_, i) => track(i + 1));

/** Sequential uids and a seeded LCG, so shuffles are reproducible. */
export function testEnv(seed = 42): QueueEnv {
  let counter = 0;
  let state = seed >>> 0;
  return {
    uid: () => {
      counter += 1;
      return `u${counter}`;
    },
    rng: () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    },
  };
}

export const ids = (items: readonly QueueItem[]): string[] => items.map((item) => item.track.id);

export const currentId = (state: { current: QueueItem | null }): string | null =>
  state.current?.track.id ?? null;
```

- [ ] **Step 2: Write the failing tests**

`packages/core/src/queue/shuffle.test.ts`:
```ts
import { expect, test } from 'vitest';
import { shuffled } from './shuffle';
import { testEnv } from './test-helpers';

test('returns a permutation without mutating the input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const copy = input.slice();
  const out = shuffled(input, testEnv(3).rng);
  expect(input).toEqual(copy);
  expect([...out].sort((a, b) => a - b)).toEqual(copy);
  expect(out).not.toEqual(copy);
});

test('stays in bounds for rng values at the edges of [0, 1)', () => {
  expect(shuffled([1, 2, 3], () => 0).sort()).toEqual([1, 2, 3]);
  expect(shuffled([1, 2, 3], () => 0.999_999).sort()).toEqual([1, 2, 3]);
  expect(shuffled([], () => 0.5)).toEqual([]);
});
```

`packages/core/src/queue/queue.navigation.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import * as q from './queue';
import { ctx, currentId, ids, testEnv, track, tracks } from './test-helpers';
import type { QueueState } from './types';

describe('playContext', () => {
  test('starts at the chosen index and queues the rest of the context', () => {
    const s = q.playContext(q.emptyQueue, tracks(4), 1, ctx, testEnv());
    expect(currentId(s)).toBe('audius:t2');
    expect(ids(q.upcoming(s))).toEqual(['audius:t3', 'audius:t4']);
    expect(s.context).toEqual(ctx);
  });

  test('clamps out-of-range start indexes', () => {
    expect(currentId(q.playContext(q.emptyQueue, tracks(3), 99, ctx, testEnv()))).toBe('audius:t3');
    expect(currentId(q.playContext(q.emptyQueue, tracks(3), -5, ctx, testEnv()))).toBe('audius:t1');
  });

  test('ignores an empty context', () => {
    expect(q.playContext(q.emptyQueue, [], 0, ctx, testEnv())).toBe(q.emptyQueue);
  });

  test('keeps items the user already queued', () => {
    const env = testEnv();
    const queued = q.addToQueue(q.emptyQueue, [track(9)], env);
    const s = q.playContext(queued, tracks(2), 0, ctx, env);
    expect(ids(q.upcoming(s))).toEqual(['audius:t9', 'audius:t2']);
  });

  test('gives duplicate tracks distinct uids', () => {
    const s = q.playContext(q.emptyQueue, [track(1), track(1)], 0, ctx, testEnv());
    expect(new Set(s.order.map((item) => item.uid)).size).toBe(2);
  });

  test('with shuffle on, plays the chosen track first and every other track once', () => {
    const s = q.playContext({ ...q.emptyQueue, shuffle: true }, tracks(8), 3, ctx, testEnv());
    expect(currentId(s)).toBe('audius:t4');
    expect(s.index).toBe(0);
    expect([...ids(s.order)].sort()).toEqual([...ids(s.original)].sort());
    expect(ids(s.original)).toEqual(tracks(8).map((t) => t.id));
  });
});

describe('next', () => {
  test('walks the context, then stops at the end with repeat off', () => {
    const env = testEnv();
    const first = q.next(q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), env);
    expect(first.effect).toBe('play');
    expect(currentId(first.state)).toBe('audius:t2');
    const end = q.next(first.state, env);
    expect(end.effect).toBe('stop');
    expect(currentId(end.state)).toBe('audius:t2');
  });

  test('plays queued items first, then resumes the context where it left off', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(3), 0, ctx, env), [track(8), track(9)], env);
    const a = q.next(s, env);
    expect(currentId(a.state)).toBe('audius:t8');
    expect(a.state.currentFromUpNext).toBe(true);
    const b = q.next(a.state, env);
    expect(currentId(b.state)).toBe('audius:t9');
    const c = q.next(b.state, env);
    expect(currentId(c.state)).toBe('audius:t2');
    expect(c.state.currentFromUpNext).toBe(false);
  });

  test('playNext puts items ahead of earlier queued items', () => {
    const env = testEnv();
    const base = q.addToQueue(q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), [track(8)], env);
    const s = q.playNext(base, [track(9)], env);
    expect(ids(q.upcoming(s))).toEqual(['audius:t9', 'audius:t8', 'audius:t2']);
  });

  test('wraps to the start with repeat all', () => {
    const env = testEnv();
    const s: QueueState = { ...q.playContext(q.emptyQueue, tracks(2), 1, ctx, env), repeat: 'all' };
    const step = q.next(s, env);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).toBe('audius:t1');
    expect(step.state.index).toBe(0);
  });

  test('reshuffles on wrap with shuffle + repeat all, never replaying the last track first', () => {
    const env = testEnv(7);
    let s: QueueState = {
      ...q.playContext({ ...q.emptyQueue, shuffle: true }, tracks(5), 0, ctx, env),
      repeat: 'all',
    };
    for (let i = 0; i < 4; i++) s = q.next(s, env).state;
    const last = s.current;
    const step = q.next(s, env);
    expect(step.effect).toBe('play');
    expect(step.state.current?.uid).not.toBe(last?.uid);
    expect([...ids(step.state.order)].sort()).toEqual(tracks(5).map((t) => t.id).sort());
  });

  test('stops on an empty queue', () => {
    expect(q.next(q.emptyQueue, testEnv()).effect).toBe('stop');
  });
});

describe('trackEnded', () => {
  test('restarts the same track with repeat one', () => {
    const env = testEnv();
    const s: QueueState = { ...q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), repeat: 'one' };
    expect(q.trackEnded(s, env)).toEqual({ state: s, effect: 'restart' });
  });

  test('advances otherwise; an explicit next() still skips under repeat one', () => {
    const env = testEnv();
    const s = q.playContext(q.emptyQueue, tracks(2), 0, ctx, env);
    expect(currentId(q.trackEnded(s, env).state)).toBe('audius:t2');
    expect(currentId(q.next({ ...s, repeat: 'one' }, env).state)).toBe('audius:t2');
  });
});

describe('prev', () => {
  const env = testEnv();
  const atSecond = q.next(q.playContext(q.emptyQueue, tracks(3), 0, ctx, env), env).state;

  test('restarts when more than 3 seconds in', () => {
    expect(q.prev(atSecond, 3.5).effect).toBe('restart');
  });

  test('goes to the previous context track near the start', () => {
    const step = q.prev(atSecond, 1);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).toBe('audius:t1');
  });

  test('restarts on the first track', () => {
    const first = q.playContext(q.emptyQueue, tracks(3), 0, ctx, testEnv());
    expect(q.prev(first, 0).effect).toBe('restart');
  });

  test('returns to the context track that played before a queued item', () => {
    const e = testEnv();
    const s = q.next(q.addToQueue(q.playContext(q.emptyQueue, tracks(3), 1, ctx, e), [track(9)], e), e).state;
    expect(currentId(s)).toBe('audius:t9');
    const step = q.prev(s, 0);
    expect(currentId(step.state)).toBe('audius:t2');
    expect(step.state.currentFromUpNext).toBe(false);
  });

  test('does nothing when nothing is loaded', () => {
    expect(q.prev(q.emptyQueue, 0).effect).toBe('none');
  });
});

describe('repeat and selectors', () => {
  test('cycleRepeat goes off → all → one → off', () => {
    const a = q.cycleRepeat(q.emptyQueue);
    const b = q.cycleRepeat(a);
    const c = q.cycleRepeat(b);
    expect([a.repeat, b.repeat, c.repeat]).toEqual(['all', 'one', 'off']);
  });

  test('hasNext accounts for queued items and repeat all', () => {
    const env = testEnv();
    const last = q.playContext(q.emptyQueue, tracks(2), 1, ctx, env);
    expect(q.hasNext(last)).toBe(false);
    expect(q.hasNext({ ...last, repeat: 'all' })).toBe(true);
    expect(q.hasNext(q.addToQueue(last, [track(5)], env))).toBe(true);
  });

  test('state survives a JSON round trip (used for persistence)', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(3), 1, ctx, env), [track(7)], env);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @riff/core exec vitest run src/queue`
Expected: FAIL, because `./shuffle` and `./queue` cannot be resolved.

- [ ] **Step 4: Implement**

`packages/core/src/queue/shuffle.ts`:
```ts
/** Fisher–Yates shuffle into a new array. `rng` must return a float in [0, 1). */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const held = result[i] as T;
    result[i] = result[j] as T;
    result[j] = held;
  }
  return result;
}
```

`packages/core/src/queue/queue.ts`:
```ts
import type { Track } from '../types';
import { shuffled } from './shuffle';
import type {
  QueueContext,
  QueueEnv,
  QueueItem,
  QueueState,
  QueueStep,
  RepeatMode,
} from './types';

/** Pressing "previous" later than this restarts the current track instead. */
export const RESTART_THRESHOLD_SEC = 3;

export const emptyQueue: QueueState = {
  context: null,
  original: [],
  order: [],
  index: -1,
  upNext: [],
  current: null,
  currentFromUpNext: false,
  shuffle: false,
  repeat: 'off',
};

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

const toItems = (tracks: readonly Track[], env: QueueEnv): QueueItem[] =>
  tracks.map((track) => ({ uid: env.uid(), track }));

const play = (state: QueueState): QueueStep => ({ state, effect: 'play' });

const stay = (state: QueueState, effect: 'restart' | 'stop' | 'none'): QueueStep => ({
  state,
  effect,
});

/** Replaces the context and starts playing `tracks[startIndex]`. Queued items are kept. */
export function playContext(
  state: QueueState,
  tracks: readonly Track[],
  startIndex: number,
  context: QueueContext,
  env: QueueEnv,
): QueueState {
  if (tracks.length === 0) return state;
  const items = toItems(tracks, env);
  const start = Math.min(Math.max(Math.trunc(startIndex), 0), items.length - 1);
  const first = items[start] as QueueItem;
  const order = state.shuffle
    ? [first, ...shuffled(items.filter((_, i) => i !== start), env.rng)]
    : items;
  return {
    ...state,
    context,
    original: items,
    order,
    index: state.shuffle ? 0 : start,
    current: first,
    currentFromUpNext: false,
  };
}

export function next(state: QueueState, env: QueueEnv): QueueStep {
  const [head, ...rest] = state.upNext;
  if (head) return play({ ...state, upNext: rest, current: head, currentFromUpNext: true });

  const following = state.order[state.index + 1];
  if (following) {
    return play({ ...state, index: state.index + 1, current: following, currentFromUpNext: false });
  }

  if (state.repeat === 'all' && state.order.length > 0) {
    const order = state.shuffle ? reshuffle(state.order, state.current, env.rng) : state.order;
    return play({ ...state, order, index: 0, current: order[0] as QueueItem, currentFromUpNext: false });
  }
  return stay(state, 'stop');
}

export function trackEnded(state: QueueState, env: QueueEnv): QueueStep {
  if (state.repeat === 'one' && state.current) return stay(state, 'restart');
  return next(state, env);
}

export function prev(state: QueueState, positionSec: number): QueueStep {
  if (!state.current) return stay(state, 'none');
  if (positionSec > RESTART_THRESHOLD_SEC) return stay(state, 'restart');
  if (state.currentFromUpNext) {
    const anchor = state.order[state.index];
    return anchor
      ? play({ ...state, current: anchor, currentFromUpNext: false })
      : stay(state, 'restart');
  }
  const previous = state.order[state.index - 1];
  if (previous) return play({ ...state, index: state.index - 1, current: previous });
  return stay(state, 'restart');
}

export function cycleRepeat(state: QueueState): QueueState {
  return { ...state, repeat: REPEAT_CYCLE[state.repeat] };
}

/** Everything that will play after `current`, in order (what the queue panel shows). */
export function upcoming(state: QueueState): QueueItem[] {
  return [...state.upNext, ...state.order.slice(state.index + 1)];
}

export function hasNext(state: QueueState): boolean {
  return (
    state.upNext.length > 0 ||
    state.index + 1 < state.order.length ||
    (state.repeat === 'all' && state.order.length > 0)
  );
}

export function addToQueue(state: QueueState, tracks: readonly Track[], env: QueueEnv): QueueState {
  return { ...state, upNext: [...state.upNext, ...toItems(tracks, env)] };
}

export function playNext(state: QueueState, tracks: readonly Track[], env: QueueEnv): QueueState {
  return { ...state, upNext: [...toItems(tracks, env), ...state.upNext] };
}

function reshuffle(
  order: readonly QueueItem[],
  last: QueueItem | null,
  rng: () => number,
): QueueItem[] {
  const result = shuffled(order, rng);
  const end = result.length - 1;
  if (end > 0 && last && result[0]?.uid === last.uid) {
    const held = result[0];
    result[0] = result[end] as QueueItem;
    result[end] = held;
  }
  return result;
}
```

Replace `packages/core/src/index.ts`:
```ts
export * from './genres';
export * from './ids';
export * from './lyrics';
export * as queue from './queue/queue';
export { shuffled } from './queue/shuffle';
export type * from './queue/types';
export * from './types';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/core test && pnpm --filter @riff/core typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add pure queue navigation (play, next, prev, repeat, up next)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Queue state machine — shuffle toggle and queue editing

**Files:**
- Modify: `packages/core/src/queue/queue.ts` (append functions)
- Test: `packages/core/src/queue/queue.editing.test.ts`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces (added to namespace `queue`):
  - `jumpTo(state, uid): QueueStep`: jumping to a queued item drops the queued items before it; jumping to an upcoming context item keeps `upNext`; unknown or already-played uids return `none`.
  - `removeFromQueue(state, uid): QueueState`: removes from `upNext`, or an *upcoming* context item from both `order` and `original`; never the current item or already-played items.
  - `moveInQueue(state, uid, toIndex): QueueState`: reorders within `upNext` only; `toIndex` is clamped.
  - `clearUpNext(state): QueueState`
  - `toggleShuffle(state, env): QueueState`:
    - On: the current context item goes first, then every other context item once, shuffled, with `index = 0`.
    - Off: restores `original`, with `index` at the current context item.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/queue/queue.editing.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import * as q from './queue';
import { ctx, currentId, ids, testEnv, track, tracks } from './test-helpers';

describe('jumpTo', () => {
  test('jumping to a queued item drops the queued items before it', () => {
    const env = testEnv();
    const s = q.addToQueue(
      q.playContext(q.emptyQueue, tracks(2), 0, ctx, env),
      [track(7), track(8), track(9)],
      env,
    );
    const step = q.jumpTo(s, s.upNext[1]!.uid);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).toBe('audius:t8');
    expect(ids(q.upcoming(step.state))).toEqual(['audius:t9', 'audius:t2']);
  });

  test('jumping ahead in the context keeps queued items', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(4), 0, ctx, env), [track(9)], env);
    const step = q.jumpTo(s, s.order[2]!.uid);
    expect(currentId(step.state)).toBe('audius:t3');
    expect(step.state.index).toBe(2);
    expect(ids(q.upcoming(step.state))).toEqual(['audius:t9', 'audius:t4']);
  });

  test('ignores unknown or already-played uids', () => {
    const env = testEnv();
    const s = q.next(q.playContext(q.emptyQueue, tracks(3), 0, ctx, env), env).state;
    expect(q.jumpTo(s, 'nope').effect).toBe('none');
    expect(q.jumpTo(s, s.order[0]!.uid).effect).toBe('none');
  });
});

describe('removeFromQueue', () => {
  test('removes a queued item by uid, leaving a duplicate of the same track', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(1), 0, ctx, env), [track(5), track(5)], env);
    const out = q.removeFromQueue(s, s.upNext[0]!.uid);
    expect(ids(out.upNext)).toEqual(['audius:t5']);
    expect(out.upNext[0]!.uid).toBe(s.upNext[1]!.uid);
  });

  test('removes an upcoming context item from both order and original', () => {
    const env = testEnv();
    const s = q.playContext(q.emptyQueue, tracks(3), 0, ctx, env);
    const out = q.removeFromQueue(s, s.order[2]!.uid);
    expect(ids(out.order)).toEqual(['audius:t1', 'audius:t2']);
    expect(ids(out.original)).toEqual(['audius:t1', 'audius:t2']);
  });

  test('never removes the current or an already-played item', () => {
    const env = testEnv();
    const s = q.next(q.playContext(q.emptyQueue, tracks(3), 0, ctx, env), env).state;
    expect(q.removeFromQueue(s, s.order[0]!.uid)).toBe(s);
    expect(q.removeFromQueue(s, s.order[1]!.uid)).toBe(s);
  });
});

describe('moveInQueue and clearUpNext', () => {
  test('moves a queued item and clamps the destination', () => {
    const env = testEnv();
    const s = q.addToQueue(q.emptyQueue, [track(1), track(2), track(3)], env);
    expect(ids(q.moveInQueue(s, s.upNext[0]!.uid, 2).upNext)).toEqual([
      'audius:t2',
      'audius:t3',
      'audius:t1',
    ]);
    expect(ids(q.moveInQueue(s, s.upNext[2]!.uid, -10).upNext)).toEqual([
      'audius:t3',
      'audius:t1',
      'audius:t2',
    ]);
    expect(q.moveInQueue(s, 'missing', 0)).toBe(s);
  });

  test('clearUpNext empties only the user queue', () => {
    const env = testEnv();
    const s = q.addToQueue(q.playContext(q.emptyQueue, tracks(2), 0, ctx, env), [track(9)], env);
    expect(ids(q.upcoming(q.clearUpNext(s)))).toEqual(['audius:t2']);
  });
});

describe('toggleShuffle', () => {
  test('turning on keeps the current track first and includes every context track once', () => {
    const env = testEnv();
    const s = q.playContext(q.emptyQueue, tracks(6), 2, ctx, env);
    const on = q.toggleShuffle(s, env);
    expect(on.shuffle).toBe(true);
    expect(on.index).toBe(0);
    expect(on.order[0]!.uid).toBe(s.current!.uid);
    expect([...ids(on.order)].sort()).toEqual([...ids(s.original)].sort());
    expect(on.original).toBe(s.original);
  });

  test('turning off restores context order positioned at the current track', () => {
    const env = testEnv();
    const shuffledState = q.toggleShuffle(q.playContext(q.emptyQueue, tracks(6), 2, ctx, env), env);
    const advanced = q.next(shuffledState, env).state;
    const off = q.toggleShuffle(advanced, env);
    expect(off.shuffle).toBe(false);
    expect(ids(off.order)).toEqual(tracks(6).map((t) => t.id));
    expect(off.order[off.index]!.uid).toBe(advanced.current!.uid);
  });

  test('works before anything from the context has played', () => {
    const env = testEnv();
    const on = q.toggleShuffle(q.addToQueue(q.emptyQueue, [track(1)], env), env);
    expect(on.index).toBe(-1);
    expect(on.order).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @riff/core exec vitest run src/queue/queue.editing.test.ts`
Expected: FAIL with `q.jumpTo is not a function` (and similar for the other new functions).

- [ ] **Step 3: Implement (append to `packages/core/src/queue/queue.ts`)**

```ts
export function jumpTo(state: QueueState, uid: string): QueueStep {
  const queued = state.upNext.findIndex((item) => item.uid === uid);
  if (queued >= 0) {
    return play({
      ...state,
      upNext: state.upNext.slice(queued + 1),
      current: state.upNext[queued] as QueueItem,
      currentFromUpNext: true,
    });
  }
  const position = state.order.findIndex((item) => item.uid === uid);
  if (position > state.index) {
    return play({
      ...state,
      index: position,
      current: state.order[position] as QueueItem,
      currentFromUpNext: false,
    });
  }
  return stay(state, 'none');
}

export function removeFromQueue(state: QueueState, uid: string): QueueState {
  const keep = (item: QueueItem) => item.uid !== uid;
  if (state.upNext.some((item) => item.uid === uid)) {
    return { ...state, upNext: state.upNext.filter(keep) };
  }
  const position = state.order.findIndex((item) => item.uid === uid);
  if (position <= state.index) return state;
  return { ...state, order: state.order.filter(keep), original: state.original.filter(keep) };
}

export function moveInQueue(state: QueueState, uid: string, toIndex: number): QueueState {
  const from = state.upNext.findIndex((item) => item.uid === uid);
  if (from < 0) return state;
  const items = state.upNext.slice();
  const [moved] = items.splice(from, 1);
  const to = Math.min(Math.max(Math.trunc(toIndex), 0), items.length);
  items.splice(to, 0, moved as QueueItem);
  return { ...state, upNext: items };
}

export function clearUpNext(state: QueueState): QueueState {
  return { ...state, upNext: [] };
}

export function toggleShuffle(state: QueueState, env: QueueEnv): QueueState {
  const anchor = state.order[state.index];
  if (!state.shuffle) {
    const rest = shuffled(
      state.original.filter((item) => item.uid !== anchor?.uid),
      env.rng,
    );
    return anchor
      ? { ...state, shuffle: true, order: [anchor, ...rest], index: 0 }
      : { ...state, shuffle: true, order: rest, index: -1 };
  }
  const index = anchor ? state.original.findIndex((item) => item.uid === anchor.uid) : -1;
  return { ...state, shuffle: false, order: state.original, index };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/core test && pnpm --filter @riff/core typecheck`
Expected: PASS (all queue tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add shuffle toggle and queue editing (jump, remove, move, clear)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Catalog package, errors and cache

**Files:**
- Create: `packages/catalog/package.json`, `packages/catalog/tsconfig.json`, `packages/catalog/src/index.ts`, `packages/catalog/src/errors.ts`, `packages/catalog/src/cache.ts`
- Test: `packages/catalog/src/cache.test.ts`

**Interfaces:**
- Consumes: nothing yet (depends on `@riff/core` from Task 8 onward).
- Produces:
  - `type CatalogErrorCode = 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'UPSTREAM_TIMEOUT'`
  - `class CatalogError extends Error { code; upstream: string | undefined }`. Its constructor is `(code, message, { upstream?, cause? })`.
  - `isCatalogError(e, code?): e is CatalogError`
  - `type Ttl<T> = number | ((value: T) => number)`
  - `interface Cache { get<T>(key): T | undefined; set<T>(key, value, ttlMs): void; getOrSet<T>(key, ttl: Ttl<T>, loader: () => Promise<T>): Promise<T> }`
  - `createMemoryCache({ maxEntries = 1000, now = Date.now }?): Cache`: LRU, TTL and single-flight. Never cache `undefined`; use `null` for "known missing".

- [ ] **Step 1: Create the package shell**

`packages/catalog/package.json`:
```json
{
  "name": "@riff/catalog",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:live": "LIVE=1 vitest run src/live.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@riff/core": "workspace:*" },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/catalog/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

`packages/catalog/src/index.ts`:
```ts
export { type Cache, createMemoryCache, type MemoryCacheOptions, type Ttl } from './cache';
export { CatalogError, type CatalogErrorCode, isCatalogError } from './errors';
```

`packages/catalog/src/errors.ts`:
```ts
export type CatalogErrorCode = 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'UPSTREAM_TIMEOUT';

export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  /** Upstream service involved, e.g. "audius" or "lrclib". */
  readonly upstream: string | undefined;

  constructor(
    code: CatalogErrorCode,
    message: string,
    options: { upstream?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'CatalogError';
    this.code = code;
    this.upstream = options.upstream;
  }
}

export function isCatalogError(error: unknown, code?: CatalogErrorCode): error is CatalogError {
  return error instanceof CatalogError && (code === undefined || error.code === code);
}
```

Run: `pnpm install`
Expected: links `@riff/core` into `packages/catalog/node_modules`.

- [ ] **Step 2: Write the failing test**

`packages/catalog/src/cache.test.ts`:
```ts
import { describe, expect, test, vi } from 'vitest';
import { createMemoryCache } from './cache';

function clock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('createMemoryCache', () => {
  test('keeps values until their ttl expires', () => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now });
    cache.set('k', 'v', 1_000);
    expect(cache.get('k')).toBe('v');
    c.advance(999);
    expect(cache.get('k')).toBe('v');
    c.advance(1);
    expect(cache.get('k')).toBeUndefined();
  });

  test('evicts the least recently used entry', () => {
    const cache = createMemoryCache({ maxEntries: 2 });
    cache.set('a', 1, 60_000);
    cache.set('b', 2, 60_000);
    cache.get('a');
    cache.set('c', 3, 60_000);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  test('getOrSet runs the loader once for concurrent callers and then serves the cache', async () => {
    const cache = createMemoryCache();
    const loader = vi.fn(async () => 'value');
    const results = await Promise.all([
      cache.getOrSet('k', 1_000, loader),
      cache.getOrSet('k', 1_000, loader),
    ]);
    expect(results).toEqual(['value', 'value']);
    await cache.getOrSet('k', 1_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('getOrSet does not cache rejections', async () => {
    const cache = createMemoryCache();
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(cache.getOrSet('k', 1_000, failing)).rejects.toThrow('boom');
    await expect(cache.getOrSet('k', 1_000, async () => 'ok')).resolves.toBe('ok');
  });

  test('getOrSet derives the ttl from the loaded value', async () => {
    const c = clock();
    const cache = createMemoryCache({ now: c.now });
    await cache.getOrSet('miss', (value: string | null) => (value ? 10_000 : 100), async () => null);
    expect(cache.get('miss')).toBeNull();
    c.advance(100);
    expect(cache.get('miss')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @riff/catalog exec vitest run src/cache.test.ts`
Expected: FAIL, because `./cache` cannot be resolved.

- [ ] **Step 4: Implement**

`packages/catalog/src/cache.ts`:
```ts
export type Ttl<T> = number | ((value: T) => number);

export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  /**
   * Returns the cached value, or runs `loader` once even for concurrent callers.
   * Rejections are not cached. Never cache `undefined`; use `null` for "known missing".
   */
  getOrSet<T>(key: string, ttl: Ttl<T>, loader: () => Promise<T>): Promise<T>;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
  now?: () => number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export function createMemoryCache({
  maxEntries = 1000,
  now = Date.now,
}: MemoryCacheOptions = {}): Cache {
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();

  function get<T>(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    // Re-insert so Map order tracks recency (first key = least recently used).
    entries.delete(key);
    entries.set(key, entry);
    return entry.value as T;
  }

  function set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttlMs });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function getOrSet<T>(key: string, ttl: Ttl<T>, loader: () => Promise<T>): Promise<T> {
    const cached = get<T>(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        set(key, value, typeof ttl === 'function' ? ttl(value) : ttl);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return { get, set, getOrSet };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/catalog pnpm-lock.yaml
git commit -m "feat(catalog): add CatalogError and an LRU/TTL single-flight cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: HTTP client, fake fetch and adapter interfaces

**Files:**
- Create: `packages/catalog/src/http.ts`, `packages/catalog/src/testing/fake-fetch.ts`, `packages/catalog/src/adapter.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/src/http.test.ts`

**Interfaces:**
- Consumes: `CatalogError` (Task 6); `Track`, `Artist`, `Collection`, `StreamInfo`, `TrendingWindow`, `SourceId` (`@riff/core`).
- Produces:
  - `type FetchLike = (input: string, init?: RequestInit) => Promise<Response>`
  - `interface GetJsonOptions { upstream: string; signal?: AbortSignal; notFoundStatuses?: readonly number[] }`. `notFoundStatuses` defaults to `[404]`.
  - `interface HttpClient { getJson<T>(url: string, options: GetJsonOptions): Promise<T | null> }`
  - `createHttpClient({ fetch?, userAgent }): HttpClient`. It maps failures:
    - a not-found status → `null`
    - any other non-2xx → `UPSTREAM_ERROR`
    - a timeout abort → `UPSTREAM_TIMEOUT`
    - a network error or invalid JSON → `UPSTREAM_ERROR`
  - `fakeFetch(routes: FakeRoute[]): FakeFetch`, where `FakeFetch` is `FetchLike & { requests: { url, headers }[]; unmatched: string[] }`. `FakeRoute = { match: string | RegExp; status?; json?; text?; delayMs?; error? }`; the first matching route wins, and an unmatched URL gets HTTP 501.
  - `interface CallOptions { signal?: AbortSignal }`; `interface ListOptions extends CallOptions { limit: number }`; `interface TrendingOptions extends ListOptions { genre?: string; window?: TrendingWindow }`
  - `interface SourceAdapter`, exactly as defined in Step 3.
  - `interface RadioAdapter extends SourceAdapter { top(options: ListOptions & { tag?: string }): Promise<Track[]> }`

- [ ] **Step 1: Write the fake fetch and adapter interfaces**

`packages/catalog/src/testing/fake-fetch.ts`:
```ts
import type { FetchLike } from '../http';

export interface FakeRoute {
  /** Substring or pattern matched against the full request URL. First match wins. */
  match: string | RegExp;
  status?: number;
  /** Serialised as the JSON response body. */
  json?: unknown;
  /** Raw response body; takes precedence over `json`. */
  text?: string;
  /** Waits before responding; rejects with the signal's reason if aborted meanwhile. */
  delayMs?: number;
  /** Rejects instead of responding (simulates a network failure). */
  error?: Error;
}

export interface FakeFetch extends FetchLike {
  requests: { url: string; headers: Headers }[];
  unmatched: string[];
}

export function fakeFetch(routes: FakeRoute[]): FakeFetch {
  const requests: FakeFetch['requests'] = [];
  const unmatched: string[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url: input, headers: new Headers(init?.headers) });
    const route = routes.find((r) =>
      typeof r.match === 'string' ? input.includes(r.match) : r.match.test(input),
    );
    if (!route) {
      unmatched.push(input);
      return new Response('no fake route', { status: 501 });
    }
    if (route.delayMs) await sleep(route.delayMs, init?.signal ?? undefined);
    if (route.error) throw route.error;
    const body = route.text ?? (route.json === undefined ? null : JSON.stringify(route.json));
    return new Response(body, {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Object.assign(fetch, { requests, unmatched });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
```

`packages/catalog/src/adapter.ts`:
```ts
import type { Artist, Collection, SourceId, StreamInfo, Track, TrendingWindow } from '@riff/core';

export interface CallOptions {
  signal?: AbortSignal;
}

export interface ListOptions extends CallOptions {
  limit: number;
}

export interface TrendingOptions extends ListOptions {
  genre?: string;
  window?: TrendingWindow;
}

/** One music source. Optional methods are capabilities a source may lack. */
export interface SourceAdapter {
  readonly id: SourceId;
  searchTracks(query: string, options: ListOptions): Promise<Track[]>;
  searchArtists?(query: string, options: ListOptions): Promise<Artist[]>;
  searchCollections?(query: string, options: ListOptions): Promise<Collection[]>;
  trending?(options: TrendingOptions): Promise<Track[]>;
  /** Resolves to null when the id is unknown or not playable. */
  getTrack(nativeId: string, options?: CallOptions): Promise<Track | null>;
  getArtist?(nativeId: string, options?: CallOptions): Promise<Artist | null>;
  getArtistTracks?(nativeId: string, options: ListOptions): Promise<Track[]>;
  getRelatedArtists?(nativeId: string, options: ListOptions): Promise<Artist[]>;
  /** Includes playable tracks. */
  getCollection?(nativeId: string, options?: CallOptions): Promise<Collection | null>;
  /** Rejects with CatalogError NOT_FOUND when the item cannot be streamed. */
  resolveStream(nativeId: string, options?: CallOptions): Promise<StreamInfo>;
}

export interface RadioAdapter extends SourceAdapter {
  top(options: ListOptions & { tag?: string }): Promise<Track[]>;
}
```

- [ ] **Step 2: Write the failing test**

`packages/catalog/src/http.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { createHttpClient } from './http';
import { fakeFetch } from './testing/fake-fetch';

describe('createHttpClient().getJson', () => {
  test('parses JSON and sends accept and user-agent headers', async () => {
    const fetch = fakeFetch([{ match: '/ok', json: { hello: 'world' } }]);
    const http = createHttpClient({ fetch, userAgent: 'Riff/test' });
    await expect(http.getJson('https://x.test/ok', { upstream: 'x' })).resolves.toEqual({
      hello: 'world',
    });
    expect(fetch.requests[0]!.headers.get('user-agent')).toBe('Riff/test');
    expect(fetch.requests[0]!.headers.get('accept')).toBe('application/json');
  });

  test('resolves null for not-found statuses', async () => {
    const fetch = fakeFetch([
      { match: '/missing', status: 404, json: {} },
      { match: '/bad-id', status: 400, json: {} },
    ]);
    const http = createHttpClient({ fetch, userAgent: 'ua' });
    await expect(http.getJson('https://x.test/missing', { upstream: 'x' })).resolves.toBeNull();
    await expect(
      http.getJson('https://x.test/bad-id', { upstream: 'x', notFoundStatuses: [400, 404] }),
    ).resolves.toBeNull();
  });

  test('maps other HTTP errors to UPSTREAM_ERROR tagged with the upstream', async () => {
    const http = createHttpClient({
      fetch: fakeFetch([{ match: '/', status: 503, json: {} }]),
      userAgent: 'ua',
    });
    await expect(http.getJson('https://x.test/', { upstream: 'audius' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      upstream: 'audius',
    });
  });

  test('maps timeouts to UPSTREAM_TIMEOUT', async () => {
    const http = createHttpClient({
      fetch: fakeFetch([{ match: '/slow', delayMs: 500, json: {} }]),
      userAgent: 'ua',
    });
    await expect(
      http.getJson('https://x.test/slow', { upstream: 'x', signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });

  test('maps network failures and invalid JSON to UPSTREAM_ERROR', async () => {
    const fetch = fakeFetch([
      { match: '/down', error: new TypeError('fetch failed') },
      { match: '/html', text: '<html>' },
    ]);
    const http = createHttpClient({ fetch, userAgent: 'ua' });
    await expect(http.getJson('https://x.test/down', { upstream: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    await expect(http.getJson('https://x.test/html', { upstream: 'x' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @riff/catalog exec vitest run src/http.test.ts`
Expected: FAIL, because `./http` cannot be resolved.

- [ ] **Step 4: Implement**

`packages/catalog/src/http.ts`:
```ts
import { CatalogError } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GetJsonOptions {
  /** Upstream name used in errors, e.g. "audius". */
  upstream: string;
  signal?: AbortSignal;
  /** Statuses meaning "no such entity"; they resolve to null. Defaults to [404]. */
  notFoundStatuses?: readonly number[];
}

export interface HttpClient {
  getJson<T>(url: string, options: GetJsonOptions): Promise<T | null>;
}

export function createHttpClient({
  fetch = globalThis.fetch,
  userAgent,
}: {
  fetch?: FetchLike;
  userAgent: string;
}): HttpClient {
  return {
    async getJson<T>(url: string, { upstream, signal, notFoundStatuses = [404] }: GetJsonOptions) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': userAgent },
          signal,
        });
      } catch (error) {
        throw toCatalogError(error, upstream, signal);
      }
      if (notFoundStatuses.includes(response.status)) {
        response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok) {
        response.body?.cancel().catch(() => undefined);
        throw new CatalogError('UPSTREAM_ERROR', `${upstream} responded with HTTP ${response.status}`, {
          upstream,
        });
      }
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw toCatalogError(error, upstream, signal);
      }
    },
  };
}

function isTimeoutError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'name' in value && value.name === 'TimeoutError';
}

function toCatalogError(error: unknown, upstream: string, signal?: AbortSignal): CatalogError {
  if (isTimeoutError(error) || (signal?.aborted && isTimeoutError(signal.reason))) {
    return new CatalogError('UPSTREAM_TIMEOUT', `${upstream} timed out`, { upstream, cause: error });
  }
  return new CatalogError('UPSTREAM_ERROR', `${upstream} request failed`, { upstream, cause: error });
}
```

Replace `packages/catalog/src/index.ts`:
```ts
export type {
  CallOptions,
  ListOptions,
  RadioAdapter,
  SourceAdapter,
  TrendingOptions,
} from './adapter';
export { type Cache, createMemoryCache, type MemoryCacheOptions, type Ttl } from './cache';
export { CatalogError, type CatalogErrorCode, isCatalogError } from './errors';
export { createHttpClient, type FetchLike, type GetJsonOptions, type HttpClient } from './http';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): add JSON http client, fake fetch and source adapter interfaces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Audius adapter

**Files:**
- Create: `packages/catalog/src/sources/audius/types.ts`, `.../audius/fixtures.ts`, `.../audius/map.ts`, `.../audius/adapter.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/src/sources/audius/map.test.ts`, `packages/catalog/src/sources/audius/adapter.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `CatalogError`, `SourceAdapter` (Tasks 6–7); `makeEntityId`, `Track`, `Artist`, `Collection`, `Artwork` (`@riff/core`).
- Produces:
  - `interface AudiusConfig { apiUrl: string; appName: string }`
  - `createAudiusAdapter({ http, config }): SourceAdapter` with id `'audius'`. It implements every optional method.
  - `mapTrack`, `mapTracks`, `mapUser`, `mapPlaylist(p, { withTracks })`, `mapArtwork`, `isPlayable`, and `mirrorUrls(url, hosts)`. These are exported from `map.ts` / `adapter.ts` for tests; they are not part of the package index.
  - `rawTrack`, `rawUser` and `rawPlaylist` fixture factories, used in later tasks' tests.

**Mapping rules** (spec §2, §4):
- `permalink` → `https://audius.co` + permalink.
- `artwork` sizes 150/480/1000 → `sm`/`md`/`lg`.
- `cover_photo['2000x'] ?? ['640x']` → `banner`.
- Blank title → `'Untitled'`.
- `bpm <= 0` → omitted.

- [ ] **Step 1: Write the raw types and fixture factories**

These fixtures are trimmed from real API responses captured on 2026-09-27.

`packages/catalog/src/sources/audius/types.ts`:
```ts
export interface AudiusArtwork {
  '150x150'?: string;
  '480x480'?: string;
  '1000x1000'?: string;
  mirrors?: string[];
}

export interface AudiusUser {
  id: string;
  name: string;
  handle: string;
  is_verified: boolean;
  bio?: string | null;
  follower_count?: number;
  track_count?: number;
  profile_picture?: AudiusArtwork | null;
  cover_photo?: { '640x'?: string; '2000x'?: string } | null;
}

export interface AudiusTrack {
  id: string;
  title: string;
  duration?: number | null;
  user: AudiusUser;
  genre?: string | null;
  mood?: string | null;
  bpm?: number | null;
  release_date?: string | null;
  play_count?: number;
  permalink?: string | null;
  artwork?: AudiusArtwork | null;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  is_delete?: boolean;
  /** Signed stream URL plus mirror hosts; regenerated on every response. */
  stream?: { url: string; mirrors?: string[] } | null;
}

export interface AudiusPlaylist {
  id: string;
  playlist_name: string;
  description?: string | null;
  is_album: boolean;
  track_count?: number;
  permalink?: string | null;
  artwork?: AudiusArtwork | null;
  user: AudiusUser;
  tracks?: AudiusTrack[] | null;
}
```

`packages/catalog/src/sources/audius/fixtures.ts`:
```ts
import type { AudiusArtwork, AudiusPlaylist, AudiusTrack, AudiusUser } from './types';

const art = (base: string): AudiusArtwork => ({
  '150x150': `${base}/150x150.jpg`,
  '480x480': `${base}/480x480.jpg`,
  '1000x1000': `${base}/1000x1000.jpg`,
});

export function rawUser(overrides: Partial<AudiusUser> = {}): AudiusUser {
  return {
    id: 'k259kWP',
    name: 'Van Snyder',
    handle: 'vansnydermusic',
    is_verified: true,
    bio: 'Trance producer',
    follower_count: 5120,
    track_count: 87,
    profile_picture: art('https://cdn.test/pp'),
    cover_photo: {
      '640x': 'https://cdn.test/cover/640x.jpg',
      '2000x': 'https://cdn.test/cover/2000x.jpg',
    },
    ...overrides,
  };
}

export function rawTrack(overrides: Partial<AudiusTrack> = {}): AudiusTrack {
  return {
    id: 'NQwXON0',
    title: 'Rave! Code Radio 025',
    duration: 3573,
    user: rawUser(),
    genre: 'Electronic',
    mood: 'Fiery',
    bpm: 120,
    release_date: '2026-09-21T18:03:02.638196Z',
    play_count: 1183,
    permalink: '/vansnydermusic/rave-code-radio-025',
    artwork: art('https://cdn.test/art'),
    is_streamable: true,
    is_stream_gated: false,
    is_delete: false,
    stream: {
      url: 'https://node-a.test/tracks/cidstream/baeaaa?signature=%7B%22a%22%3A1%7D',
      mirrors: ['https://node-b.test', 'https://node-c.test'],
    },
    ...overrides,
  };
}

export function rawPlaylist(overrides: Partial<AudiusPlaylist> = {}): AudiusPlaylist {
  return {
    id: 'xPjKvK9',
    playlist_name: 'Walk with me',
    description: 'A long walk',
    is_album: false,
    track_count: 3,
    permalink: '/lottaboom/playlist/walk-with-me',
    artwork: art('https://cdn.test/pl'),
    user: rawUser({ id: 'bQ3Kk', name: 'KaRMaTRaiN379', handle: 'karmatrain' }),
    tracks: [
      rawTrack(),
      rawTrack({ id: 'Abc123', title: 'Second' }),
      rawTrack({ id: 'Gated1', is_stream_gated: true }),
    ],
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/catalog/src/sources/audius/map.test.ts`:
```ts
import { ArtistSchema, CollectionSchema, TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { rawPlaylist, rawTrack, rawUser } from './fixtures';
import { isPlayable, mapPlaylist, mapTrack, mapTracks, mapUser } from './map';

describe('mapTrack', () => {
  test('maps every field', () => {
    expect(mapTrack(rawTrack())).toEqual({
      id: 'audius:NQwXON0',
      source: 'audius',
      title: 'Rave! Code Radio 025',
      artists: [{ id: 'audius:k259kWP', name: 'Van Snyder' }],
      durationSec: 3573,
      isLive: false,
      artwork: {
        sm: 'https://cdn.test/art/150x150.jpg',
        md: 'https://cdn.test/art/480x480.jpg',
        lg: 'https://cdn.test/art/1000x1000.jpg',
      },
      genre: 'Electronic',
      mood: 'Fiery',
      bpm: 120,
      releaseDate: '2026-09-21T18:03:02.638196Z',
      playCount: 1183,
      permalink: 'https://audius.co/vansnydermusic/rave-code-radio-025',
    });
    expect(TrackSchema.safeParse(mapTrack(rawTrack())).success).toBe(true);
  });

  test('tolerates missing optional metadata', () => {
    const t = mapTrack(
      rawTrack({
        title: '   ',
        genre: '',
        mood: null,
        bpm: 0,
        release_date: null,
        artwork: null,
        permalink: null,
        duration: null,
      }),
    );
    expect(TrackSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ title: 'Untitled', durationSec: 0, artwork: {} });
    expect(t.genre).toBeUndefined();
    expect(t.bpm).toBeUndefined();
    expect(t.permalink).toBeUndefined();
  });
});

describe('isPlayable / mapTracks', () => {
  test('drops gated, deleted and unstreamable tracks', () => {
    expect(isPlayable(rawTrack())).toBe(true);
    expect(isPlayable(rawTrack({ is_stream_gated: true }))).toBe(false);
    expect(isPlayable(rawTrack({ is_delete: true }))).toBe(false);
    expect(isPlayable(rawTrack({ is_streamable: false }))).toBe(false);
    expect(mapTracks([rawTrack(), rawTrack({ id: 'x', is_delete: true })])).toHaveLength(1);
  });
});

describe('mapUser', () => {
  test('maps an artist and falls back to the smaller banner', () => {
    expect(mapUser(rawUser())).toEqual({
      id: 'audius:k259kWP',
      source: 'audius',
      name: 'Van Snyder',
      handle: 'vansnydermusic',
      avatar: {
        sm: 'https://cdn.test/pp/150x150.jpg',
        md: 'https://cdn.test/pp/480x480.jpg',
        lg: 'https://cdn.test/pp/1000x1000.jpg',
      },
      banner: 'https://cdn.test/cover/2000x.jpg',
      bio: 'Trance producer',
      followerCount: 5120,
      trackCount: 87,
      verified: true,
    });
    const small = mapUser(rawUser({ cover_photo: { '640x': 'https://cdn.test/c/640x.jpg' } }));
    expect(small.banner).toBe('https://cdn.test/c/640x.jpg');
    const bare = mapUser(rawUser({ profile_picture: null, cover_photo: null, bio: null }));
    expect(ArtistSchema.safeParse(bare).success).toBe(true);
    expect(bare.avatar).toEqual({});
  });
});

describe('mapPlaylist', () => {
  test('maps playlists and albums, with playable tracks only when asked', () => {
    const withTracks = mapPlaylist(rawPlaylist(), { withTracks: true });
    expect(withTracks.kind).toBe('playlist');
    expect(withTracks.owner).toEqual({ id: 'audius:bQ3Kk', name: 'KaRMaTRaiN379' });
    expect(withTracks.tracks?.map((t) => t.id)).toEqual(['audius:NQwXON0', 'audius:Abc123']);
    expect(CollectionSchema.safeParse(withTracks).success).toBe(true);

    const album = mapPlaylist(rawPlaylist({ is_album: true }), { withTracks: false });
    expect(album.kind).toBe('album');
    expect(album.tracks).toBeUndefined();
    expect(album.trackCount).toBe(3);
  });
});
```

`packages/catalog/src/sources/audius/adapter.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../../http';
import { type FakeRoute, fakeFetch } from '../../testing/fake-fetch';
import { createAudiusAdapter } from './adapter';
import { rawPlaylist, rawTrack, rawUser } from './fixtures';

const config = { apiUrl: 'https://api.audius.test', appName: 'riff-test' };

function setup(routes: FakeRoute[]) {
  const fetch = fakeFetch(routes);
  const adapter = createAudiusAdapter({ http: createHttpClient({ fetch, userAgent: 'ua' }), config });
  return { adapter, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('audius adapter', () => {
  test('searchTracks encodes the query, sends app_name and drops unplayable tracks', async () => {
    const { adapter, url } = setup([
      {
        match: '/v1/tracks/search',
        json: { data: [rawTrack(), rawTrack({ id: 'gated', is_stream_gated: true })] },
      },
    ]);
    const tracks = await adapter.searchTracks('AC/DC & Beyoncé', { limit: 5 });
    expect(tracks.map((t) => t.id)).toEqual(['audius:NQwXON0']);
    expect(url().pathname).toBe('/v1/tracks/search');
    expect(url().searchParams.get('query')).toBe('AC/DC & Beyoncé');
    expect(url().searchParams.get('limit')).toBe('5');
    expect(url().searchParams.get('app_name')).toBe('riff-test');
  });

  test('trending passes genre and time window, omitting genre when absent', async () => {
    const { adapter, url } = setup([{ match: '/v1/tracks/trending', json: { data: [rawTrack()] } }]);
    await adapter.trending!({ genre: 'Lo-Fi', window: 'month', limit: 10 });
    expect(url(0).searchParams.get('genre')).toBe('Lo-Fi');
    expect(url(0).searchParams.get('time')).toBe('month');
    await adapter.trending!({ limit: 10 });
    expect(url(1).searchParams.has('genre')).toBe(false);
    expect(url(1).searchParams.get('time')).toBe('week');
  });

  test('getTrack maps a track and returns null for invalid ids or unplayable tracks', async () => {
    const { adapter } = setup([
      { match: '/v1/tracks/NQwXON0', json: { data: rawTrack() } },
      { match: '/v1/tracks/zzz', status: 400, json: { code: 400, error: 'invalid trackId' } },
      { match: '/v1/tracks/gone', json: { data: rawTrack({ id: 'gone', is_delete: true }) } },
    ]);
    expect((await adapter.getTrack('NQwXON0'))?.title).toBe('Rave! Code Radio 025');
    expect(await adapter.getTrack('zzz')).toBeNull();
    expect(await adapter.getTrack('gone')).toBeNull();
  });

  test('artist endpoints map users, top tracks by plays and related artists', async () => {
    const { adapter, fetch } = setup([
      { match: '/v1/users/k259kWP/tracks', json: { data: [rawTrack()] } },
      { match: '/v1/users/k259kWP/related', json: { data: [rawUser({ id: 'rel1', name: 'Rel' })] } },
      { match: '/v1/users/k259kWP', json: { data: rawUser() } },
      { match: '/v1/users/nope', status: 400, json: {} },
    ]);
    expect((await adapter.getArtist!('k259kWP'))?.name).toBe('Van Snyder');
    expect(await adapter.getArtist!('nope')).toBeNull();
    const top = await adapter.getArtistTracks!('k259kWP', { limit: 10 });
    expect(top.map((t) => t.id)).toEqual(['audius:NQwXON0']);
    expect(new URL(fetch.requests[2]!.url).searchParams.get('sort')).toBe('plays');
    const related = await adapter.getRelatedArtists!('k259kWP', { limit: 5 });
    expect(related[0]?.id).toBe('audius:rel1');
  });

  test('getCollection unwraps the single-item array', async () => {
    const { adapter } = setup([
      { match: '/v1/playlists/xPjKvK9', json: { data: [rawPlaylist()] } },
      { match: '/v1/playlists/none', json: { data: [] } },
    ]);
    const collection = await adapter.getCollection!('xPjKvK9');
    expect(collection?.tracks?.map((t) => t.id)).toEqual(['audius:NQwXON0', 'audius:Abc123']);
    expect(await adapter.getCollection!('none')).toBeNull();
  });

  test('artist and collection search omit collection tracks', async () => {
    const { adapter } = setup([
      { match: '/v1/users/search', json: { data: [rawUser()] } },
      { match: '/v1/playlists/search', json: { data: [rawPlaylist({ is_album: true })] } },
    ]);
    expect((await adapter.searchArtists!('van', { limit: 3 }))[0]?.verified).toBe(true);
    const [album] = await adapter.searchCollections!('walk', { limit: 3 });
    expect(album?.kind).toBe('album');
    expect(album?.tracks).toBeUndefined();
  });

  test('resolveStream returns the signed url plus distinct mirrors on other hosts', async () => {
    const signed = 'https://node-a.test/tracks/cidstream/cid?signature=%7B%22a%22%3A1%7D';
    const { adapter } = setup([
      {
        match: '/v1/tracks/NQwXON0',
        json: {
          data: rawTrack({
            stream: {
              url: signed,
              mirrors: ['https://node-a.test', 'https://node-b.test', 'https://node-b.test', 'nope'],
            },
          }),
        },
      },
    ]);
    await expect(adapter.resolveStream('NQwXON0')).resolves.toEqual({
      url: signed,
      mirrors: ['https://node-b.test/tracks/cidstream/cid?signature=%7B%22a%22%3A1%7D'],
      live: false,
    });
  });

  test('resolveStream falls back to the stream endpoint and rejects unplayable tracks', async () => {
    const { adapter, url } = setup([
      { match: '/v1/tracks/old/stream', json: { data: 'https://node-a.test/tracks/cidstream/old' } },
      { match: '/v1/tracks/old', json: { data: rawTrack({ id: 'old', stream: null }) } },
      { match: '/v1/tracks/gated', json: { data: rawTrack({ id: 'gated', is_stream_gated: true }) } },
    ]);
    await expect(adapter.resolveStream('old')).resolves.toEqual({
      url: 'https://node-a.test/tracks/cidstream/old',
      mirrors: [],
      live: false,
    });
    expect(url(1).searchParams.get('no_redirect')).toBe('true');
    await expect(adapter.resolveStream('gated')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @riff/catalog exec vitest run src/sources/audius`
Expected: FAIL, because `./map` and `./adapter` cannot be resolved.

- [ ] **Step 4: Implement**

`packages/catalog/src/sources/audius/map.ts`:
```ts
import { type Artist, type Artwork, type Collection, makeEntityId, type Track } from '@riff/core';
import type { AudiusArtwork, AudiusPlaylist, AudiusTrack, AudiusUser } from './types';

const AUDIUS_WEB = 'https://audius.co';

export function mapArtwork(art: AudiusArtwork | null | undefined): Artwork {
  return {
    sm: art?.['150x150'] || undefined,
    md: art?.['480x480'] || undefined,
    lg: art?.['1000x1000'] || undefined,
  };
}

export function isPlayable(track: AudiusTrack): boolean {
  return track.is_streamable !== false && !track.is_stream_gated && !track.is_delete;
}

export function mapTrack(track: AudiusTrack): Track {
  return {
    id: makeEntityId('audius', track.id),
    source: 'audius',
    title: track.title.trim() || 'Untitled',
    artists: [{ id: makeEntityId('audius', track.user.id), name: track.user.name }],
    durationSec: Math.max(0, track.duration ?? 0),
    isLive: false,
    artwork: mapArtwork(track.artwork),
    genre: track.genre || undefined,
    mood: track.mood || undefined,
    bpm: track.bpm && track.bpm > 0 ? track.bpm : undefined,
    releaseDate: track.release_date || undefined,
    playCount: track.play_count ?? undefined,
    permalink: track.permalink ? `${AUDIUS_WEB}${track.permalink}` : undefined,
  };
}

export const mapTracks = (tracks: readonly AudiusTrack[]): Track[] =>
  tracks.filter(isPlayable).map(mapTrack);

export function mapUser(user: AudiusUser): Artist {
  return {
    id: makeEntityId('audius', user.id),
    source: 'audius',
    name: user.name,
    handle: user.handle || undefined,
    avatar: mapArtwork(user.profile_picture),
    banner: user.cover_photo?.['2000x'] || user.cover_photo?.['640x'] || undefined,
    bio: user.bio || undefined,
    followerCount: user.follower_count ?? undefined,
    trackCount: user.track_count ?? undefined,
    verified: user.is_verified,
  };
}

export function mapPlaylist(
  playlist: AudiusPlaylist,
  { withTracks }: { withTracks: boolean },
): Collection {
  return {
    id: makeEntityId('audius', playlist.id),
    source: 'audius',
    kind: playlist.is_album ? 'album' : 'playlist',
    title: playlist.playlist_name,
    description: playlist.description || undefined,
    artwork: mapArtwork(playlist.artwork),
    owner: { id: makeEntityId('audius', playlist.user.id), name: playlist.user.name },
    trackCount: playlist.track_count ?? undefined,
    tracks: withTracks ? mapTracks(playlist.tracks ?? []) : undefined,
  };
}
```

`packages/catalog/src/sources/audius/adapter.ts`:
```ts
import type { SourceAdapter } from '../../adapter';
import { CatalogError } from '../../errors';
import type { HttpClient } from '../../http';
import { isPlayable, mapPlaylist, mapTrack, mapTracks, mapUser } from './map';
import type { AudiusPlaylist, AudiusTrack, AudiusUser } from './types';

export interface AudiusConfig {
  apiUrl: string;
  appName: string;
}

type Params = Record<string, string | number | undefined>;

/** Rebuilds a signed stream URL on each mirror host, skipping the original host and bad entries. */
export function mirrorUrls(url: string, hosts: readonly string[]): string[] {
  const original = new URL(url);
  const result = new Set<string>();
  for (const host of hosts) {
    let mirror: URL;
    try {
      mirror = new URL(host);
    } catch {
      continue;
    }
    if (mirror.host === original.host) continue;
    const candidate = new URL(url);
    candidate.protocol = mirror.protocol;
    candidate.host = mirror.host;
    result.add(candidate.toString());
  }
  return [...result];
}

export function createAudiusAdapter({
  http,
  config,
}: {
  http: HttpClient;
  config: AudiusConfig;
}): SourceAdapter {
  const base = config.apiUrl.replace(/\/$/, '');
  const enc = encodeURIComponent;

  function endpoint(path: string, params: Params = {}): string {
    const url = new URL(`${base}/v1${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('app_name', config.appName);
    return url.toString();
  }

  async function list<T>(path: string, params: Params, signal?: AbortSignal): Promise<T[]> {
    const body = await http.getJson<{ data: T[] | null }>(endpoint(path, params), {
      upstream: 'audius',
      signal,
    });
    return body?.data ?? [];
  }

  /** Single-entity read: Audius answers 400 for ids it cannot decode. */
  async function one<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    const body = await http.getJson<{ data: T | null }>(endpoint(path), {
      upstream: 'audius',
      signal,
      notFoundStatuses: [400, 404],
    });
    return body?.data ?? null;
  }

  async function playableTrack(id: string, signal?: AbortSignal): Promise<AudiusTrack | null> {
    const track = await one<AudiusTrack>(`/tracks/${enc(id)}`, signal);
    return track && isPlayable(track) ? track : null;
  }

  return {
    id: 'audius',

    async searchTracks(query, { limit, signal }) {
      return mapTracks(await list<AudiusTrack>('/tracks/search', { query, limit }, signal));
    },

    async searchArtists(query, { limit, signal }) {
      return (await list<AudiusUser>('/users/search', { query, limit }, signal)).map(mapUser);
    },

    async searchCollections(query, { limit, signal }) {
      const playlists = await list<AudiusPlaylist>('/playlists/search', { query, limit }, signal);
      return playlists.map((playlist) => mapPlaylist(playlist, { withTracks: false }));
    },

    async trending({ genre, window = 'week', limit, signal }) {
      return mapTracks(
        await list<AudiusTrack>('/tracks/trending', { genre, time: window, limit }, signal),
      );
    },

    async getTrack(id, options) {
      const track = await playableTrack(id, options?.signal);
      return track ? mapTrack(track) : null;
    },

    async getArtist(id, options) {
      const user = await one<AudiusUser>(`/users/${enc(id)}`, options?.signal);
      return user ? mapUser(user) : null;
    },

    async getArtistTracks(id, { limit, signal }) {
      return mapTracks(
        await list<AudiusTrack>(`/users/${enc(id)}/tracks`, { sort: 'plays', limit }, signal),
      );
    },

    async getRelatedArtists(id, { limit, signal }) {
      return (await list<AudiusUser>(`/users/${enc(id)}/related`, { limit }, signal)).map(mapUser);
    },

    async getCollection(id, options) {
      const data = await one<AudiusPlaylist[]>(`/playlists/${enc(id)}`, options?.signal);
      const playlist = data?.[0];
      return playlist ? mapPlaylist(playlist, { withTracks: true }) : null;
    },

    async resolveStream(id, options) {
      const track = await playableTrack(id, options?.signal);
      if (!track) {
        throw new CatalogError('NOT_FOUND', `audius:${id} is not streamable`, { upstream: 'audius' });
      }
      if (track.stream?.url) {
        return {
          url: track.stream.url,
          mirrors: mirrorUrls(track.stream.url, track.stream.mirrors ?? []),
          live: false,
        };
      }
      const body = await http.getJson<{ data: string | null }>(
        endpoint(`/tracks/${enc(id)}/stream`, { no_redirect: 'true' }),
        { upstream: 'audius', signal: options?.signal },
      );
      if (!body?.data) {
        throw new CatalogError('NOT_FOUND', `audius:${id} has no stream`, { upstream: 'audius' });
      }
      return { url: body.data, mirrors: [], live: false };
    },
  };
}
```

Add to `packages/catalog/src/index.ts`:
```ts
export { type AudiusConfig, createAudiusAdapter } from './sources/audius/adapter';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): add Audius adapter with mirror-aware stream resolution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Jamendo adapter

**Files:**
- Create: `packages/catalog/src/sources/jamendo/types.ts`, `.../jamendo/fixtures.ts`, `.../jamendo/map.ts`, `.../jamendo/adapter.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/src/sources/jamendo/map.test.ts`, `packages/catalog/src/sources/jamendo/adapter.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `CatalogError`, `SourceAdapter` (Tasks 6–7); `makeEntityId`, domain types (`@riff/core`).
- Produces:
  - `interface JamendoConfig { clientId: string; apiUrl?: string }`. `apiUrl` defaults to `https://api.jamendo.com/v3.0`.
  - `createJamendoAdapter({ http, config }): SourceAdapter` with id `'jamendo'`. It has no `getRelatedArtists`.
  - Album ids are `jamendo:album:<id>`; `getCollection` accepts the native id `album:<id>`.
  - `toJamendoTag(genre)` and `fromJamendoTag(tag)`, used for the genre filter and labels.

**Note:** no Jamendo key was available while this plan was written. The raw shapes follow Jamendo's v3.0 docs, and the live test (Task 13) checks them once `JAMENDO_CLIENT_ID` is set.

- [ ] **Step 1: Write the raw types and fixture factories**

`packages/catalog/src/sources/jamendo/types.ts`:
```ts
export interface JamendoResponse<T> {
  headers: {
    status: 'success' | 'failed';
    code: number;
    error_message: string;
    results_count: number;
  };
  results: T[];
}

export interface JamendoTrack {
  id: string;
  name: string;
  /** Seconds; sometimes serialised as a string. */
  duration: number | string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  releasedate: string;
  image: string;
  album_image?: string;
  /** Streamable MP3 URL; empty when streaming is not allowed. */
  audio: string;
  shareurl?: string;
  musicinfo?: { tags?: { genres?: string[] } };
}

export interface JamendoArtist {
  id: string;
  name: string;
  image: string;
  shareurl?: string;
}

export interface JamendoAlbumTrack {
  id: string;
  name: string;
  duration: number | string;
  audio: string;
  position?: string;
}

export interface JamendoAlbum {
  id: string;
  name: string;
  artist_id: string;
  artist_name: string;
  image: string;
  releasedate: string;
  tracks?: JamendoAlbumTrack[];
}
```

`packages/catalog/src/sources/jamendo/fixtures.ts`:
```ts
import type { JamendoAlbum, JamendoArtist, JamendoResponse, JamendoTrack } from './types';

export function rawJamendoTrack(overrides: Partial<JamendoTrack> = {}): JamendoTrack {
  return {
    id: '1886257',
    name: 'Sunny Side',
    duration: 187,
    artist_id: '7872',
    artist_name: 'Ketsa',
    album_id: '404149',
    album_name: 'Good Vibes',
    releasedate: '2021-05-14',
    image: 'https://usercontent.jamendo.com?type=album&id=404149&width=600&trackid=1886257',
    album_image: 'https://usercontent.jamendo.com?type=album&id=404149&width=600',
    audio: 'https://prod-1.storage.jamendo.com/?trackid=1886257&format=mp32',
    shareurl: 'https://www.jamendo.com/track/1886257',
    musicinfo: { tags: { genres: ['electronic', 'lounge'] } },
    ...overrides,
  };
}

export function rawJamendoArtist(overrides: Partial<JamendoArtist> = {}): JamendoArtist {
  return {
    id: '7872',
    name: 'Ketsa',
    image: 'https://usercontent.jamendo.com?type=artist&id=7872&width=300',
    ...overrides,
  };
}

export function rawJamendoAlbum(overrides: Partial<JamendoAlbum> = {}): JamendoAlbum {
  return {
    id: '404149',
    name: 'Good Vibes',
    artist_id: '7872',
    artist_name: 'Ketsa',
    image: 'https://usercontent.jamendo.com?type=album&id=404149&width=600',
    releasedate: '2021-05-14',
    tracks: [
      { id: '1886257', name: 'Sunny Side', duration: '187', audio: 'https://audio.test/1', position: '1' },
      { id: '1886258', name: 'No Stream', duration: '201', audio: '', position: '2' },
    ],
    ...overrides,
  };
}

export function jamendoOk<T>(results: T[]): JamendoResponse<T> {
  return {
    headers: { status: 'success', code: 0, error_message: '', results_count: results.length },
    results,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/catalog/src/sources/jamendo/map.test.ts`:
```ts
import { CollectionSchema, TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { rawJamendoAlbum, rawJamendoArtist, rawJamendoTrack } from './fixtures';
import { fromJamendoTag, mapAlbum, mapArtist, mapTrack, mapTracks, toJamendoTag } from './map';

describe('mapTrack', () => {
  test('maps every field, sizing artwork via the width parameter', () => {
    expect(mapTrack(rawJamendoTrack())).toEqual({
      id: 'jamendo:1886257',
      source: 'jamendo',
      title: 'Sunny Side',
      artists: [{ id: 'jamendo:7872', name: 'Ketsa' }],
      album: { id: 'jamendo:album:404149', title: 'Good Vibes' },
      durationSec: 187,
      isLive: false,
      artwork: {
        sm: 'https://usercontent.jamendo.com/?type=album&id=404149&width=200&trackid=1886257',
        md: 'https://usercontent.jamendo.com/?type=album&id=404149&width=500&trackid=1886257',
        lg: 'https://usercontent.jamendo.com/?type=album&id=404149&width=600&trackid=1886257',
      },
      genre: 'Electronic',
      releaseDate: '2021-05-14',
      permalink: 'https://www.jamendo.com/track/1886257',
    });
  });

  test('handles string and empty durations, missing images, albums and tags', () => {
    const t = mapTrack(
      rawJamendoTrack({ duration: '', image: '', album_image: '', album_id: '0', musicinfo: undefined }),
    );
    expect(TrackSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({ durationSec: 0, artwork: {} });
    expect(t.album).toBeUndefined();
    expect(t.genre).toBeUndefined();
    expect(mapTrack(rawJamendoTrack({ duration: '201' })).durationSec).toBe(201);
  });

  test('mapTracks drops tracks without a streamable audio url', () => {
    expect(mapTracks([rawJamendoTrack(), rawJamendoTrack({ id: '2', audio: '' })])).toHaveLength(1);
  });
});

describe('mapArtist / mapAlbum', () => {
  test('maps an artist', () => {
    expect(mapArtist(rawJamendoArtist())).toMatchObject({
      id: 'jamendo:7872',
      source: 'jamendo',
      name: 'Ketsa',
      verified: false,
    });
  });

  test('maps an album with its streamable tracks credited to the album artist', () => {
    const album = mapAlbum(rawJamendoAlbum(), { withTracks: true });
    expect(CollectionSchema.safeParse(album).success).toBe(true);
    expect(album).toMatchObject({ id: 'jamendo:album:404149', kind: 'album', trackCount: 1 });
    expect(album.tracks?.[0]).toMatchObject({
      id: 'jamendo:1886257',
      artists: [{ id: 'jamendo:7872', name: 'Ketsa' }],
      album: { id: 'jamendo:album:404149', title: 'Good Vibes' },
      durationSec: 187,
    });
    expect(mapAlbum(rawJamendoAlbum({ tracks: undefined }), { withTracks: false }).trackCount).toBeUndefined();
  });
});

describe('genre tags', () => {
  test('translate between Audius genre names and Jamendo tags', () => {
    expect(toJamendoTag('Hip-Hop/Rap')).toBe('hiphop');
    expect(toJamendoTag('Drum & Bass')).toBe('drumnbass');
    expect(toJamendoTag('Deep House')).toBe('deephouse');
    expect(fromJamendoTag('hiphop')).toBe('Hip-Hop/Rap');
    expect(fromJamendoTag('lounge')).toBe('Lounge');
  });
});
```

`packages/catalog/src/sources/jamendo/adapter.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../../http';
import { type FakeRoute, fakeFetch } from '../../testing/fake-fetch';
import { createJamendoAdapter } from './adapter';
import { jamendoOk, rawJamendoAlbum, rawJamendoArtist, rawJamendoTrack } from './fixtures';

function setup(routes: FakeRoute[]) {
  const fetch = fakeFetch(routes);
  const adapter = createJamendoAdapter({
    http: createHttpClient({ fetch, userAgent: 'ua' }),
    config: { clientId: 'cid', apiUrl: 'https://api.jamendo.test/v3.0' },
  });
  return { adapter, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('jamendo adapter', () => {
  test('searchTracks sends credentials and track params and drops unstreamable tracks', async () => {
    const { adapter, url } = setup([
      {
        match: '/v3.0/tracks/',
        json: jamendoOk([rawJamendoTrack(), rawJamendoTrack({ id: '2', audio: '' })]),
      },
    ]);
    const tracks = await adapter.searchTracks('sunny side', { limit: 7 });
    expect(tracks.map((t) => t.id)).toEqual(['jamendo:1886257']);
    expect(url().pathname).toBe('/v3.0/tracks/');
    expect(Object.fromEntries(url().searchParams)).toMatchObject({
      client_id: 'cid',
      format: 'json',
      search: 'sunny side',
      limit: '7',
      include: 'musicinfo',
      audioformat: 'mp32',
    });
  });

  test('turns a failed response header into UPSTREAM_ERROR', async () => {
    const { adapter } = setup([
      {
        match: '/v3.0/tracks/',
        json: {
          headers: { status: 'failed', code: 5, error_message: 'Invalid Client Id', results_count: 0 },
          results: [],
        },
      },
    ]);
    await expect(adapter.searchTracks('x', { limit: 1 })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'jamendo: Invalid Client Id',
    });
  });

  test('trending maps the window to a popularity order and the genre to a tag', async () => {
    const { adapter, url } = setup([{ match: '/v3.0/tracks/', json: jamendoOk([rawJamendoTrack()]) }]);
    await adapter.trending!({ genre: 'Hip-Hop/Rap', window: 'allTime', limit: 5 });
    expect(url().searchParams.get('order')).toBe('popularity_total');
    expect(url().searchParams.get('tags')).toBe('hiphop');
    await adapter.trending!({ limit: 5 });
    expect(url(1).searchParams.get('order')).toBe('popularity_week');
    expect(url(1).searchParams.has('tags')).toBe(false);
  });

  test('getTrack, getArtist and getArtistTracks', async () => {
    const { adapter, url } = setup([
      { match: 'id=missing', json: jamendoOk([]) },
      { match: '/v3.0/artists/', json: jamendoOk([rawJamendoArtist()]) },
      { match: '/v3.0/tracks/', json: jamendoOk([rawJamendoTrack()]) },
    ]);
    expect((await adapter.getTrack('1886257'))?.id).toBe('jamendo:1886257');
    expect(url(0).searchParams.get('id')).toBe('1886257');
    expect(await adapter.getTrack('missing')).toBeNull();
    expect((await adapter.getArtist!('7872'))?.name).toBe('Ketsa');
    await adapter.getArtistTracks!('7872', { limit: 10 });
    expect(url(3).searchParams.get('artist_id')).toBe('7872');
    expect(url(3).searchParams.get('order')).toBe('popularity_total');
  });

  test('getCollection loads album tracks and ignores non-album ids', async () => {
    const { adapter, fetch, url } = setup([
      { match: '/v3.0/albums/tracks/', json: jamendoOk([rawJamendoAlbum()]) },
    ]);
    expect(await adapter.getCollection!('playlist:9')).toBeNull();
    expect(fetch.requests).toHaveLength(0);
    const album = await adapter.getCollection!('album:404149');
    expect(url().searchParams.get('id')).toBe('404149');
    expect(album?.tracks).toHaveLength(1);
  });

  test('search for artists and albums', async () => {
    const { adapter, url } = setup([
      { match: '/v3.0/artists/', json: jamendoOk([rawJamendoArtist()]) },
      { match: '/v3.0/albums/', json: jamendoOk([rawJamendoAlbum({ tracks: undefined })]) },
    ]);
    expect(await adapter.searchArtists!('ket', { limit: 2 })).toHaveLength(1);
    expect(url(0).searchParams.get('namesearch')).toBe('ket');
    const [album] = await adapter.searchCollections!('good', { limit: 2 });
    expect(album?.tracks).toBeUndefined();
  });

  test('resolveStream returns the audio url or NOT_FOUND', async () => {
    const { adapter } = setup([
      { match: 'id=gone', json: jamendoOk([]) },
      { match: '/v3.0/tracks/', json: jamendoOk([rawJamendoTrack()]) },
    ]);
    await expect(adapter.resolveStream('1886257')).resolves.toEqual({
      url: 'https://prod-1.storage.jamendo.com/?trackid=1886257&format=mp32',
      mirrors: [],
      live: false,
    });
    await expect(adapter.resolveStream('gone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @riff/catalog exec vitest run src/sources/jamendo`
Expected: FAIL, because `./map` and `./adapter` cannot be resolved.

- [ ] **Step 4: Implement**

`packages/catalog/src/sources/jamendo/map.ts`:
```ts
import { type Artist, type Artwork, type Collection, makeEntityId, type Track } from '@riff/core';
import type { JamendoAlbum, JamendoAlbumTrack, JamendoArtist, JamendoTrack } from './types';

const TAG_BY_GENRE: Readonly<Record<string, string>> = {
  'Hip-Hop/Rap': 'hiphop',
  'R&B/Soul': 'rnb',
  'Lo-Fi': 'lofi',
  'Drum & Bass': 'drumnbass',
};

export function toJamendoTag(genre: string): string {
  return TAG_BY_GENRE[genre] ?? genre.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function fromJamendoTag(tag: string): string {
  const known = Object.keys(TAG_BY_GENRE).find((genre) => TAG_BY_GENRE[genre] === tag);
  return known ?? tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** Jamendo image URLs take a `width` parameter; derive our three sizes from it. */
export function jamendoArtwork(image: string | null | undefined): Artwork {
  if (!image) return {};
  const sized = (width: number): string => {
    try {
      const url = new URL(image);
      if (!url.searchParams.has('width')) return image;
      url.searchParams.set('width', String(width));
      return url.toString();
    } catch {
      return image;
    }
  };
  return { sm: sized(200), md: sized(500), lg: sized(600) };
}

function seconds(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const albumEntityId = (id: string) => makeEntityId('jamendo', `album:${id}`);

export function mapTrack(track: JamendoTrack): Track {
  const tag = track.musicinfo?.tags?.genres?.[0];
  const hasAlbum = Boolean(track.album_id && track.album_id !== '0' && track.album_name);
  return {
    id: makeEntityId('jamendo', track.id),
    source: 'jamendo',
    title: track.name.trim() || 'Untitled',
    artists: [{ id: makeEntityId('jamendo', track.artist_id), name: track.artist_name }],
    album: hasAlbum ? { id: albumEntityId(track.album_id), title: track.album_name } : undefined,
    durationSec: seconds(track.duration),
    isLive: false,
    artwork: jamendoArtwork(track.image || track.album_image),
    genre: tag ? fromJamendoTag(tag) : undefined,
    releaseDate: track.releasedate || undefined,
    permalink: track.shareurl || undefined,
  };
}

export const mapTracks = (tracks: readonly JamendoTrack[]): Track[] =>
  tracks.filter((track) => track.audio).map(mapTrack);

export function mapArtist(artist: JamendoArtist): Artist {
  return {
    id: makeEntityId('jamendo', artist.id),
    source: 'jamendo',
    name: artist.name,
    avatar: jamendoArtwork(artist.image),
    verified: false,
  };
}

function mapAlbumTrack(track: JamendoAlbumTrack, album: JamendoAlbum): Track {
  return {
    id: makeEntityId('jamendo', track.id),
    source: 'jamendo',
    title: track.name.trim() || 'Untitled',
    artists: [{ id: makeEntityId('jamendo', album.artist_id), name: album.artist_name }],
    album: { id: albumEntityId(album.id), title: album.name },
    durationSec: seconds(track.duration),
    isLive: false,
    artwork: jamendoArtwork(album.image),
    releaseDate: album.releasedate || undefined,
  };
}

export function mapAlbum(album: JamendoAlbum, { withTracks }: { withTracks: boolean }): Collection {
  const streamable = (album.tracks ?? []).filter((track) => track.audio);
  return {
    id: albumEntityId(album.id),
    source: 'jamendo',
    kind: 'album',
    title: album.name,
    artwork: jamendoArtwork(album.image),
    owner: { id: makeEntityId('jamendo', album.artist_id), name: album.artist_name },
    trackCount: album.tracks ? streamable.length : undefined,
    tracks: withTracks ? streamable.map((track) => mapAlbumTrack(track, album)) : undefined,
  };
}
```

`packages/catalog/src/sources/jamendo/adapter.ts`:
```ts
import type { SourceAdapter } from '../../adapter';
import { CatalogError } from '../../errors';
import type { HttpClient } from '../../http';
import { mapAlbum, mapArtist, mapTrack, mapTracks, toJamendoTag } from './map';
import type { JamendoAlbum, JamendoArtist, JamendoResponse, JamendoTrack } from './types';

export interface JamendoConfig {
  clientId: string;
  apiUrl?: string;
}

type Params = Record<string, string | number | undefined>;

const DEFAULT_API_URL = 'https://api.jamendo.com/v3.0';
const TRACK_PARAMS: Params = { include: 'musicinfo', audioformat: 'mp32', imagesize: '600' };
const ORDER_BY_WINDOW = {
  week: 'popularity_week',
  month: 'popularity_month',
  allTime: 'popularity_total',
} as const;

export function createJamendoAdapter({
  http,
  config,
}: {
  http: HttpClient;
  config: JamendoConfig;
}): SourceAdapter {
  const base = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');

  async function results<T>(path: string, params: Params, signal?: AbortSignal): Promise<T[]> {
    const url = new URL(`${base}${path}/`);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('format', 'json');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const body = await http.getJson<JamendoResponse<T>>(url.toString(), {
      upstream: 'jamendo',
      signal,
    });
    if (!body) return [];
    if (body.headers.status !== 'success') {
      throw new CatalogError(
        'UPSTREAM_ERROR',
        `jamendo: ${body.headers.error_message || 'request failed'}`,
        { upstream: 'jamendo' },
      );
    }
    return body.results;
  }

  async function streamableTrack(id: string, signal?: AbortSignal) {
    const tracks = await results<JamendoTrack>('/tracks', { ...TRACK_PARAMS, id }, signal);
    return tracks.find((track) => track.audio) ?? null;
  }

  return {
    id: 'jamendo',

    async searchTracks(query, { limit, signal }) {
      return mapTracks(
        await results<JamendoTrack>('/tracks', { ...TRACK_PARAMS, search: query, limit }, signal),
      );
    },

    async searchArtists(query, { limit, signal }) {
      return (await results<JamendoArtist>('/artists', { namesearch: query, limit }, signal)).map(
        mapArtist,
      );
    },

    async searchCollections(query, { limit, signal }) {
      const albums = await results<JamendoAlbum>(
        '/albums',
        { namesearch: query, limit, imagesize: '600' },
        signal,
      );
      return albums.map((album) => mapAlbum(album, { withTracks: false }));
    },

    async trending({ genre, window = 'week', limit, signal }) {
      const params: Params = {
        ...TRACK_PARAMS,
        order: ORDER_BY_WINDOW[window],
        tags: genre ? toJamendoTag(genre) : undefined,
        limit,
      };
      return mapTracks(await results<JamendoTrack>('/tracks', params, signal));
    },

    async getTrack(id, options) {
      const track = await streamableTrack(id, options?.signal);
      return track ? mapTrack(track) : null;
    },

    async getArtist(id, options) {
      const [artist] = await results<JamendoArtist>('/artists', { id }, options?.signal);
      return artist ? mapArtist(artist) : null;
    },

    async getArtistTracks(id, { limit, signal }) {
      const params: Params = { ...TRACK_PARAMS, artist_id: id, order: 'popularity_total', limit };
      return mapTracks(await results<JamendoTrack>('/tracks', params, signal));
    },

    async getCollection(nativeId, options) {
      if (!nativeId.startsWith('album:')) return null;
      const albumId = nativeId.slice('album:'.length);
      const [album] = await results<JamendoAlbum>(
        '/albums/tracks',
        { id: albumId, audioformat: 'mp32', imagesize: '600' },
        options?.signal,
      );
      return album ? mapAlbum(album, { withTracks: true }) : null;
    },

    async resolveStream(id, options) {
      const track = await streamableTrack(id, options?.signal);
      if (!track) {
        throw new CatalogError('NOT_FOUND', `jamendo:${id} is not streamable`, {
          upstream: 'jamendo',
        });
      }
      return { url: track.audio, mirrors: [], live: false };
    },
  };
}
```

Add to `packages/catalog/src/index.ts`:
```ts
export { createJamendoAdapter, type JamendoConfig } from './sources/jamendo/adapter';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): add Jamendo adapter (enabled by JAMENDO_CLIENT_ID)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Radio Browser adapter

**Files:**
- Create: `packages/catalog/src/sources/radio/types.ts`, `.../radio/fixtures.ts`, `.../radio/map.ts`, `.../radio/adapter.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/src/sources/radio/map.test.ts`, `packages/catalog/src/sources/radio/adapter.test.ts`

**Interfaces:**
- Consumes: `HttpClient`, `CatalogError`, `isCatalogError`, `RadioAdapter`, `ListOptions` (Tasks 6–7).
- Produces:
  - `interface RadioConfig { servers: readonly string[] }`. Server names such as `'de1'` map to `https://de1.api.radio-browser.info/json`.
  - `createRadioAdapter({ http, config }): RadioAdapter`, with id `'radio'` and methods `searchTracks`, `top`, `getTrack` and `resolveStream`.
    - Stations are live `Track`s: `artists: []`, `durationSec: null`, `isLive: true`, and `genre` is the first tag, title-cased.
    - Failover: an `UPSTREAM_ERROR` tries the next server; an `UPSTREAM_TIMEOUT` does not.
  - `isUsableStation(station)`, `isPlayableStreamUrl(url)`, `mapStation(station)`.
  - `rawStation(overrides?)`: a fixture factory, reused in Task 13.

- [ ] **Step 1: Write the raw types and fixtures**

`packages/catalog/src/sources/radio/types.ts`:
```ts
export interface RadioStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  homepage?: string | null;
  favicon?: string | null;
  /** Comma-separated. */
  tags?: string | null;
  country?: string | null;
  countrycode?: string | null;
  codec?: string | null;
  bitrate?: number | null;
  hls: number;
  lastcheckok: number;
}

export interface RadioUrlResponse {
  ok: boolean;
  message?: string;
  stationuuid?: string;
  name?: string;
  url?: string;
}
```

`packages/catalog/src/sources/radio/fixtures.ts`:
```ts
import type { RadioStation } from './types';

export function rawStation(overrides: Partial<RadioStation> = {}): RadioStation {
  return {
    stationuuid: '9617a958-0601-11e8-ae97-52543be04c81',
    name: ' Lofi Girl Radio ',
    url_resolved: 'https://stream.lofi.test/live.mp3',
    homepage: 'https://lofi.test/',
    favicon: 'https://lofi.test/icon.png',
    tags: 'lofi,chillhop,study',
    country: 'France',
    countrycode: 'FR',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`packages/catalog/src/sources/radio/map.test.ts`:
```ts
import { TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { rawStation } from './fixtures';
import { isPlayableStreamUrl, isUsableStation, mapStation } from './map';

describe('isUsableStation', () => {
  test('accepts working https, non-HLS stations only', () => {
    expect(isUsableStation(rawStation())).toBe(true);
    expect(isUsableStation(rawStation({ url_resolved: 'http://plain.test/live' }))).toBe(false);
    expect(isUsableStation(rawStation({ hls: 1 }))).toBe(false);
    expect(isUsableStation(rawStation({ lastcheckok: 0 }))).toBe(false);
    expect(isUsableStation(rawStation({ url_resolved: 'https://x.test/index.m3u8?t=1' }))).toBe(false);
  });

  test('isPlayableStreamUrl rejects missing and playlist urls', () => {
    expect(isPlayableStreamUrl(undefined)).toBe(false);
    expect(isPlayableStreamUrl('https://x.test/master.M3U8')).toBe(false);
    expect(isPlayableStreamUrl('https://x.test/stream')).toBe(true);
  });
});

describe('mapStation', () => {
  test('maps a station to a live track', () => {
    const track = mapStation(rawStation());
    expect(track).toEqual({
      id: 'radio:9617a958-0601-11e8-ae97-52543be04c81',
      source: 'radio',
      title: 'Lofi Girl Radio',
      artists: [],
      durationSec: null,
      isLive: true,
      artwork: {
        sm: 'https://lofi.test/icon.png',
        md: 'https://lofi.test/icon.png',
        lg: 'https://lofi.test/icon.png',
      },
      genre: 'Lofi',
      permalink: 'https://lofi.test/',
    });
    expect(TrackSchema.safeParse(track).success).toBe(true);
  });

  test('drops insecure favicons and copes with missing tags and names', () => {
    const track = mapStation(
      rawStation({ favicon: 'http://x.test/i.png', tags: '', name: '  ', homepage: null }),
    );
    expect(track).toMatchObject({ title: 'Untitled station', artwork: {} });
    expect(track.genre).toBeUndefined();
    expect(track.permalink).toBeUndefined();
  });
});
```

`packages/catalog/src/sources/radio/adapter.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../../http';
import { type FakeRoute, fakeFetch } from '../../testing/fake-fetch';
import { createRadioAdapter } from './adapter';
import { rawStation } from './fixtures';

function setup(routes: FakeRoute[], servers = ['de1', 'de2']) {
  const fetch = fakeFetch(routes);
  const adapter = createRadioAdapter({
    http: createHttpClient({ fetch, userAgent: 'ua' }),
    config: { servers },
  });
  return { adapter, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('radio adapter', () => {
  test('searchTracks over-fetches, filters unusable stations and trims to the limit', async () => {
    const stations = [
      rawStation({ stationuuid: 'a' }),
      rawStation({ stationuuid: 'b', url_resolved: 'http://insecure.test/' }),
      rawStation({ stationuuid: 'c' }),
      rawStation({ stationuuid: 'd' }),
    ];
    const { adapter, url } = setup([{ match: '/json/stations/search', json: stations }]);
    const result = await adapter.searchTracks('lofi', { limit: 2 });
    expect(result.map((t) => t.id)).toEqual(['radio:a', 'radio:c']);
    expect(url().host).toBe('de1.api.radio-browser.info');
    expect(Object.fromEntries(url().searchParams)).toMatchObject({
      name: 'lofi',
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: '6',
    });
  });

  test('top filters by tag when given one', async () => {
    const { adapter, url } = setup([{ match: '/json/stations/search', json: [rawStation()] }]);
    await adapter.top({ tag: 'jazz', limit: 5 });
    expect(url(0).searchParams.get('tag')).toBe('jazz');
    await adapter.top({ limit: 5 });
    expect(url(1).searchParams.has('tag')).toBe(false);
    expect(url(1).searchParams.has('name')).toBe(false);
  });

  test('fails over to the next server on upstream errors', async () => {
    const { adapter, fetch } = setup([
      { match: 'de1.api', status: 500, json: {} },
      { match: 'de2.api', json: [rawStation()] },
    ]);
    expect(await adapter.searchTracks('x', { limit: 1 })).toHaveLength(1);
    expect(fetch.requests.map((r) => new URL(r.url).host)).toEqual([
      'de1.api.radio-browser.info',
      'de2.api.radio-browser.info',
    ]);
  });

  test('does not fail over after a timeout', async () => {
    const { adapter, fetch } = setup([{ match: 'de1.api', delayMs: 300, json: [] }]);
    await expect(
      adapter.searchTracks('x', { limit: 1, signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    expect(fetch.requests).toHaveLength(1);
  });

  test('getTrack returns usable stations only', async () => {
    const { adapter } = setup([
      { match: '/byuuid/ok', json: [rawStation({ stationuuid: 'ok' })] },
      { match: '/byuuid/hls', json: [rawStation({ stationuuid: 'hls', hls: 1 })] },
      { match: '/byuuid/none', json: [] },
    ]);
    expect((await adapter.getTrack('ok'))?.id).toBe('radio:ok');
    expect(await adapter.getTrack('hls')).toBeNull();
    expect(await adapter.getTrack('none')).toBeNull();
  });

  test('resolveStream uses the click-counting url endpoint and rejects insecure streams', async () => {
    const { adapter } = setup([
      { match: '/json/url/good', json: { ok: true, url: 'https://s.test/live.mp3' } },
      { match: '/json/url/http', json: { ok: true, url: 'http://s.test/live.mp3' } },
      { match: '/json/url/bad', json: { ok: false, message: 'no station' } },
    ]);
    await expect(adapter.resolveStream('good')).resolves.toEqual({
      url: 'https://s.test/live.mp3',
      mirrors: [],
      live: true,
    });
    await expect(adapter.resolveStream('http')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(adapter.resolveStream('bad')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @riff/catalog exec vitest run src/sources/radio`
Expected: FAIL, because `./map` and `./adapter` cannot be resolved.

- [ ] **Step 4: Implement**

`packages/catalog/src/sources/radio/map.ts`:
```ts
import { makeEntityId, type Track } from '@riff/core';
import type { RadioStation } from './types';

/** Browsers block http media on https pages, and HLS playlists need extra tooling. */
export function isPlayableStreamUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('https://') && !/\.m3u8(?:[?#]|$)/i.test(url);
}

export function isUsableStation(station: RadioStation): boolean {
  return (
    station.lastcheckok === 1 && station.hls === 0 && isPlayableStreamUrl(station.url_resolved)
  );
}

function firstTag(tags: string | null | undefined): string | undefined {
  const tag = tags
    ?.split(',')
    .map((t) => t.trim())
    .find(Boolean);
  return tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : undefined;
}

export function mapStation(station: RadioStation): Track {
  const icon = station.favicon?.startsWith('https://') ? station.favicon : undefined;
  return {
    id: makeEntityId('radio', station.stationuuid),
    source: 'radio',
    title: station.name.trim() || 'Untitled station',
    artists: [],
    durationSec: null,
    isLive: true,
    artwork: icon ? { sm: icon, md: icon, lg: icon } : {},
    genre: firstTag(station.tags),
    permalink: station.homepage || undefined,
  };
}
```

`packages/catalog/src/sources/radio/adapter.ts`:
```ts
import type { Track } from '@riff/core';
import type { ListOptions, RadioAdapter } from '../../adapter';
import { CatalogError, isCatalogError } from '../../errors';
import type { HttpClient } from '../../http';
import { isPlayableStreamUrl, isUsableStation, mapStation } from './map';
import type { RadioStation, RadioUrlResponse } from './types';

export interface RadioConfig {
  /** Radio Browser mirror names, tried in order, e.g. ["de1", "de2"]. */
  servers: readonly string[];
}

type Params = Record<string, string | number | undefined>;

/** Many stations fail the https/non-HLS filter, so ask for more than we need. */
const OVERFETCH = 3;

export function createRadioAdapter({
  http,
  config,
}: {
  http: HttpClient;
  config: RadioConfig;
}): RadioAdapter {
  async function get<T>(path: string, params: Params, signal?: AbortSignal): Promise<T | null> {
    let lastError: unknown = new CatalogError('UPSTREAM_ERROR', 'radio: no servers configured', {
      upstream: 'radio',
    });
    for (const server of config.servers) {
      const url = new URL(`https://${server}.api.radio-browser.info/json${path}`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
      try {
        return await http.getJson<T>(url.toString(), { upstream: 'radio', signal });
      } catch (error) {
        // The time budget is spent; trying another mirror would only overrun it.
        if (isCatalogError(error, 'UPSTREAM_TIMEOUT')) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  async function stations(params: Params, { limit, signal }: ListOptions): Promise<Track[]> {
    const raw = await get<RadioStation[]>(
      '/stations/search',
      { hidebroken: 'true', order: 'clickcount', reverse: 'true', ...params, limit: limit * OVERFETCH },
      signal,
    );
    return (raw ?? []).filter(isUsableStation).slice(0, limit).map(mapStation);
  }

  return {
    id: 'radio',

    searchTracks: (query, options) => stations({ name: query }, options),

    top: ({ tag, ...options }) => stations({ tag }, options),

    async getTrack(uuid, options) {
      const [station] =
        (await get<RadioStation[]>(
          `/stations/byuuid/${encodeURIComponent(uuid)}`,
          {},
          options?.signal,
        )) ?? [];
      return station && isUsableStation(station) ? mapStation(station) : null;
    },

    async resolveStream(uuid, options) {
      const body = await get<RadioUrlResponse>(
        `/url/${encodeURIComponent(uuid)}`,
        {},
        options?.signal,
      );
      if (!body?.ok || !isPlayableStreamUrl(body.url)) {
        throw new CatalogError('NOT_FOUND', `radio:${uuid} has no playable https stream`, {
          upstream: 'radio',
        });
      }
      return { url: body.url, mirrors: [], live: true };
    },
  };
}
```

Add to `packages/catalog/src/index.ts`:
```ts
export { createRadioAdapter, type RadioConfig } from './sources/radio/adapter';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): add Radio Browser adapter with https-only stations and mirror failover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: LRCLIB lyrics client

**Files:**
- Create: `packages/catalog/src/lyrics/lrclib.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/src/lyrics/lrclib.test.ts`

**Interfaces:**
- Consumes: `HttpClient` (Task 7), `CallOptions` (Task 7), `parseLrc` and `Lyrics` (`@riff/core`).
- Produces:
  - `interface LyricsQuery { title: string; artist: string; album?: string; durationSec?: number | null }`
  - `interface LyricsClient { getLyrics(query: LyricsQuery, options?: CallOptions): Promise<Lyrics | null> }`
  - `createLrclibClient({ http, baseUrl = 'https://lrclib.net' }): LyricsClient`
  - Exported for tests: `cleanTitle(title, artist)`, `pickBest(candidates, durationSec)`, `toLyrics(record)`, `type LrclibRecord`.

**Algorithm** (spec §2):
1. `GET /api/get` with the raw title, the artist, the album (if known) and the duration rounded to whole seconds.
2. If that misses or has no lyrics: `GET /api/search?track_name=<cleanTitle>&artist_name=<artist>`, then pick a candidate within ±3 s of the duration (or any candidate if the duration is unknown). Prefer synced lyrics, then plain, then instrumental.
3. Otherwise return `null`.

- [ ] **Step 1: Write the failing test**

`packages/catalog/src/lyrics/lrclib.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { createHttpClient } from '../http';
import { type FakeRoute, fakeFetch } from '../testing/fake-fetch';
import { cleanTitle, createLrclibClient, type LrclibRecord, pickBest } from './lrclib';

const record = (overrides: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id: 1,
  trackName: 'One More Time',
  artistName: 'Daft Punk',
  albumName: 'Discovery',
  duration: 320,
  instrumental: false,
  plainLyrics: 'One more time',
  syncedLyrics: '[00:30.75] One more time',
  ...overrides,
});

function setup(routes: FakeRoute[]) {
  const fetch = fakeFetch(routes);
  const client = createLrclibClient({
    http: createHttpClient({ fetch, userAgent: 'ua' }),
    baseUrl: 'https://lrclib.test',
  });
  return { client, fetch, url: (i = 0) => new URL(fetch.requests[i]!.url) };
}

describe('createLrclibClient().getLyrics', () => {
  test('returns parsed lyrics from an exact match', async () => {
    const { client, url } = setup([{ match: '/api/get', json: record() }]);
    const lyrics = await client.getLyrics({
      title: 'One More Time',
      artist: 'Daft Punk',
      album: 'Discovery',
      durationSec: 320.4,
    });
    expect(lyrics).toEqual({
      synced: [{ timeMs: 30_750, text: 'One more time' }],
      plain: 'One more time',
      instrumental: false,
    });
    expect(Object.fromEntries(url().searchParams)).toEqual({
      track_name: 'One More Time',
      artist_name: 'Daft Punk',
      album_name: 'Discovery',
      duration: '320',
    });
  });

  test('falls back to search with a cleaned title and picks the closest synced candidate', async () => {
    const { client, url } = setup([
      { match: '/api/get', status: 404, json: { code: 404, name: 'TrackNotFound' } },
      {
        match: '/api/search',
        json: [
          record({ id: 2, duration: 250, syncedLyrics: '[00:01.00] far away' }),
          record({ id: 3, duration: 321, syncedLyrics: null, plainLyrics: 'plain only' }),
          record({ id: 4, duration: 318, syncedLyrics: '[00:02.00] close' }),
        ],
      },
    ]);
    const lyrics = await client.getLyrics({
      title: 'Daft Punk - One More Time (Official Video)',
      artist: 'Daft Punk',
      durationSec: 320,
    });
    expect(lyrics?.synced).toEqual([{ timeMs: 2_000, text: 'close' }]);
    expect(url(1).searchParams.get('track_name')).toBe('One More Time');
    expect(url(1).searchParams.get('artist_name')).toBe('Daft Punk');
  });

  test('skips an exact match that has no lyrics at all', async () => {
    const { client } = setup([
      { match: '/api/get', json: record({ syncedLyrics: null, plainLyrics: null }) },
      { match: '/api/search', json: [] },
    ]);
    expect(await client.getLyrics({ title: 'x', artist: 'y' })).toBeNull();
  });

  test('reports instrumentals', async () => {
    const { client } = setup([
      { match: '/api/get', json: record({ instrumental: true, syncedLyrics: null, plainLyrics: null }) },
    ]);
    expect(await client.getLyrics({ title: 'x', artist: 'y' })).toEqual({
      synced: null,
      plain: null,
      instrumental: true,
    });
  });
});

describe('cleanTitle', () => {
  test('strips an artist prefix, feature credits and video/remaster noise', () => {
    expect(cleanTitle('Daft Punk - One More Time (Official Video)', 'Daft Punk')).toBe('One More Time');
    expect(cleanTitle('Song (feat. Someone)', 'A')).toBe('Song');
    expect(cleanTitle('Song ft. Someone', 'A')).toBe('Song');
    expect(cleanTitle('Song [Remastered 2011]', 'A')).toBe('Song');
  });

  test('keeps meaningful bracketed parts and never returns an empty string', () => {
    expect(cleanTitle('Title (Remix)', 'A')).toBe('Title (Remix)');
    expect(cleanTitle('(Official Video)', 'A')).toBe('(Official Video)');
  });
});

describe('pickBest', () => {
  test('ignores the duration filter when the duration is unknown', () => {
    expect(pickBest([record({ id: 9, duration: 999 })], null)?.id).toBe(9);
    expect(pickBest([record({ duration: 999 })], 100)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @riff/catalog exec vitest run src/lyrics`
Expected: FAIL, because `./lrclib` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/catalog/src/lyrics/lrclib.ts`:
```ts
import { type Lyrics, parseLrc } from '@riff/core';
import type { CallOptions } from '../adapter';
import type { HttpClient } from '../http';

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  durationSec?: number | null;
}

export interface LyricsClient {
  getLyrics(query: LyricsQuery, options?: CallOptions): Promise<Lyrics | null>;
}

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const DURATION_TOLERANCE_SEC = 3;
const NOISE =
  /\s*[([][^)\]]*\b(?:feat|ft|prod|official|video|audio|lyrics?|visuali[sz]er|remaster(?:ed)?|original mix)\b[^)\]]*[)\]]/gi;
const TRAILING_FEATURE = /\s+(?:feat|ft)\.?\s.*$/i;

/** Makes source titles like "Artist - Song (Official Video)" searchable. */
export function cleanTitle(title: string, artist: string): string {
  let result = title;
  const prefix = `${artist} - `.toLowerCase();
  if (artist && result.toLowerCase().startsWith(prefix)) result = result.slice(prefix.length);
  result = result.replace(NOISE, '').replace(TRAILING_FEATURE, '').replace(/\s+/g, ' ').trim();
  return result || title;
}

export function toLyrics(record: LrclibRecord): Lyrics | null {
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  const plain = record.plainLyrics?.trim() || null;
  if (synced.length === 0 && !plain && !record.instrumental) return null;
  return { synced: synced.length > 0 ? synced : null, plain, instrumental: record.instrumental };
}

export function pickBest(
  candidates: readonly LrclibRecord[],
  durationSec?: number | null,
): LrclibRecord | null {
  const pool = durationSec
    ? candidates.filter((c) => Math.abs(c.duration - durationSec) <= DURATION_TOLERANCE_SEC)
    : candidates;
  return (
    pool.find((c) => c.syncedLyrics) ?? pool.find((c) => c.plainLyrics || c.instrumental) ?? null
  );
}

export function createLrclibClient({
  http,
  baseUrl = 'https://lrclib.net',
}: {
  http: HttpClient;
  baseUrl?: string;
}): LyricsClient {
  const endpoint = (path: string, params: Record<string, string | undefined>): string => {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  };

  return {
    async getLyrics(query, options) {
      const signal = options?.signal;
      const duration = query.durationSec ? String(Math.round(query.durationSec)) : undefined;

      const exact = await http.getJson<LrclibRecord>(
        endpoint('/api/get', {
          track_name: query.title,
          artist_name: query.artist,
          album_name: query.album,
          duration,
        }),
        { upstream: 'lrclib', signal },
      );
      const fromExact = exact ? toLyrics(exact) : null;
      if (fromExact) return fromExact;

      const candidates =
        (await http.getJson<LrclibRecord[]>(
          endpoint('/api/search', {
            track_name: cleanTitle(query.title, query.artist),
            artist_name: query.artist,
          }),
          { upstream: 'lrclib', signal },
        )) ?? [];
      const best = pickBest(candidates, query.durationSec);
      return best ? toLyrics(best) : null;
    },
  };
}
```

Add to `packages/catalog/src/index.ts`:
```ts
export { createLrclibClient, type LyricsClient, type LyricsQuery } from './lyrics/lrclib';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): add LRCLIB lyrics client with exact-then-search matching

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Merge helpers and the aggregator

**Files:**
- Create: `packages/catalog/src/merge.ts`, `packages/catalog/src/aggregator.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/src/merge.test.ts`, `packages/catalog/src/aggregator.test.ts`

**Interfaces:**
- Consumes: `SourceAdapter`, `RadioAdapter` (Task 7), `Cache`/`createMemoryCache` (Task 6), `CatalogError`/`isCatalogError` (Task 6), `LyricsClient` (Task 11), and from `@riff/core` `parseEntityId`, `SOURCE_IDS` and the domain types.
- Produces:
  - `interleave<T>(lists): T[]`, `normalizeForMatch(s): string`, `dedupeKey(track): string`, `dedupeAcrossSources(tracks): Track[]`.
    - Deduplication drops a track only when an *earlier* track from a **different** source has the same key, or when it repeats an id already seen. Near-duplicates within one source (e.g. a remix) are kept.
  - `type SourceStatus = 'ok' | 'error' | 'timeout' | 'disabled'`; `type SourceStatuses = Record<SourceId, SourceStatus>`
  - `interface SearchResult { tracks; artists; collections; stations; sources }`; `interface TrendingResult { tracks; sources }`
  - `interface Catalog`. Every id parameter is a `string`, and invalid ids reject with `NOT_FOUND`.
    - `search(query, { limit })`
    - `trending({ genre?, window?, limit })`
    - `getTrack(id)`, `getArtist(id)`, `getCollection(id)`
    - `getArtistTracks(id, { limit })`, `getRelatedArtists(id, { limit })`
    - `resolveStream(id)`
    - `getLyrics(id)`
    - `radioTop({ tag?, limit })`, `radioSearch(query, { limit })`
  - `interface AggregatorDeps { music; radio; lyrics; cache; searchTimeoutMs?; entityTimeoutMs?; onSourceError?(source, error) }`
  - `createAggregator(deps): Catalog`; `CACHE_TTL` constants.

- [ ] **Step 1: Write the failing tests**

`packages/catalog/src/merge.test.ts`:
```ts
import type { SourceId, Track } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { dedupeAcrossSources, interleave, normalizeForMatch } from './merge';

const t = (source: SourceId, n: number, artist: string, title: string): Track => ({
  id: `${source}:${n}`,
  source,
  title,
  artists: [{ id: `${source}:a${n}`, name: artist }],
  durationSec: 100,
  isLive: false,
  artwork: {},
});

describe('interleave', () => {
  test('round-robins lists of different lengths', () => {
    expect(interleave([[1, 2, 3], [10], [20, 21]])).toEqual([1, 10, 20, 2, 21, 3]);
    expect(interleave([])).toEqual([]);
  });
});

describe('normalizeForMatch', () => {
  test('ignores case, accents, punctuation and feature credits', () => {
    expect(normalizeForMatch('Beyoncé – Halo (feat. X)')).toBe('beyonce halo');
    expect(normalizeForMatch('HALO ft. Someone Else')).toBe('halo');
  });

  test('keeps other bracketed words such as remix', () => {
    expect(normalizeForMatch('Song (Remix)')).toBe('song remix');
  });
});

describe('dedupeAcrossSources', () => {
  test('drops later cross-source duplicates and repeated ids but keeps same-source near-duplicates', () => {
    const tracks = [
      t('audius', 1, 'Ketsa', 'Sunny Side'),
      t('jamendo', 2, 'KETSA', 'Sunny Side (feat. Someone)'),
      t('audius', 3, 'Ketsa', 'Sunny Side'),
      t('audius', 1, 'Ketsa', 'Sunny Side'),
    ];
    expect(dedupeAcrossSources(tracks).map((x) => x.id)).toEqual(['audius:1', 'audius:3']);
  });
});
```

`packages/catalog/src/aggregator.test.ts`:
```ts
import type { SourceId, Track } from '@riff/core';
import { describe, expect, test, vi } from 'vitest';
import type { ListOptions, RadioAdapter, SourceAdapter } from './adapter';
import { createAggregator } from './aggregator';
import { createMemoryCache } from './cache';
import { CatalogError } from './errors';
import type { LyricsClient } from './lyrics/lrclib';

const t = (source: SourceId, n: number, artist = `Artist ${n}`, title = `Song ${n}`): Track => ({
  id: `${source}:${n}`,
  source,
  title,
  artists: [{ id: `${source}:a${n}`, name: artist }],
  durationSec: 100,
  isLive: false,
  artwork: {},
});

const live: Track = {
  id: 'radio:s1',
  source: 'radio',
  title: 'Station',
  artists: [],
  durationSec: null,
  isLive: true,
  artwork: {},
};

function fakeAdapter(id: SourceId, overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    id,
    searchTracks: vi.fn(async () => []),
    getTrack: vi.fn(async () => null),
    resolveStream: vi.fn(async () => ({ url: `https://${id}.test/stream`, mirrors: [], live: false })),
    ...overrides,
  };
}

function fakeRadio(overrides: Partial<RadioAdapter> = {}): RadioAdapter {
  return { ...fakeAdapter('radio'), top: vi.fn(async () => [live]), ...overrides };
}

/** Never settles until aborted, then rejects the way the http client does on timeout. */
const hang = (_query: string, options: ListOptions) =>
  new Promise<Track[]>((_, reject) => {
    options.signal?.addEventListener(
      'abort',
      () => reject(new CatalogError('UPSTREAM_TIMEOUT', 'slow')),
      { once: true },
    );
  });

const failing = async (): Promise<Track[]> => {
  throw new CatalogError('UPSTREAM_ERROR', 'down');
};

function setup(
  parts: {
    music?: SourceAdapter[];
    radio?: RadioAdapter | null;
    lyrics?: LyricsClient;
    now?: () => number;
    onSourceError?: (source: SourceId, error: unknown) => void;
  } = {},
) {
  return createAggregator({
    music: parts.music ?? [],
    radio: parts.radio ?? null,
    lyrics: parts.lyrics ?? { getLyrics: vi.fn(async () => null) },
    cache: createMemoryCache({ now: parts.now }),
    searchTimeoutMs: 30,
    onSourceError: parts.onSourceError,
  });
}

describe('search', () => {
  test('interleaves tracks across sources and reports each source', async () => {
    const audius = fakeAdapter('audius', {
      searchTracks: vi.fn(async () => [t('audius', 1), t('audius', 2)]),
    });
    const jamendo = fakeAdapter('jamendo', { searchTracks: vi.fn(async () => [t('jamendo', 3)]) });
    const result = await setup({ music: [audius, jamendo] }).search('x', { limit: 10 });
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1', 'jamendo:3', 'audius:2']);
    expect(result.sources).toEqual({ audius: 'ok', jamendo: 'ok', radio: 'disabled' });
  });

  test('returns partial results when sources fail or time out', async () => {
    const onSourceError = vi.fn();
    const audius = fakeAdapter('audius', { searchTracks: vi.fn(async () => [t('audius', 1)]) });
    const jamendo = fakeAdapter('jamendo', { searchTracks: vi.fn(hang) });
    const radio = fakeRadio({ searchTracks: vi.fn(failing) });
    const result = await setup({ music: [audius, jamendo], radio, onSourceError }).search('x', {
      limit: 10,
    });
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1']);
    expect(result.sources).toEqual({ audius: 'ok', jamendo: 'timeout', radio: 'error' });
    expect(onSourceError).toHaveBeenCalledWith('jamendo', expect.any(CatalogError));
    expect(onSourceError).toHaveBeenCalledWith('radio', expect.any(CatalogError));
  });

  test('dedupes across sources only', async () => {
    const audius = fakeAdapter('audius', {
      searchTracks: vi.fn(async () => [
        t('audius', 1, 'Ketsa', 'Sunny Side'),
        t('audius', 2, 'Ketsa', 'Sunny Side'),
      ]),
    });
    const jamendo = fakeAdapter('jamendo', {
      searchTracks: vi.fn(async () => [t('jamendo', 3, 'KETSA', 'Sunny Side (feat. Someone)')]),
    });
    const result = await setup({ music: [audius, jamendo] }).search('sunny', { limit: 10 });
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1', 'audius:2']);
  });

  test('puts radio results in stations, and artists/collections alongside tracks', async () => {
    const audius = fakeAdapter('audius', {
      searchTracks: vi.fn(async () => [t('audius', 1)]),
      searchArtists: vi.fn(async () => [
        { id: 'audius:a1', source: 'audius', name: 'A', avatar: {}, verified: false } as const,
      ]),
    });
    const radio = fakeRadio({ searchTracks: vi.fn(async () => [live]) });
    const result = await setup({ music: [audius], radio }).search('x', { limit: 5 });
    expect(result.stations.map((s) => s.id)).toEqual(['radio:s1']);
    expect(result.tracks.map((s) => s.id)).toEqual(['audius:1']);
    expect(result.artists.map((a) => a.id)).toEqual(['audius:a1']);
    expect(result.collections).toEqual([]);
    expect(result.sources.radio).toBe('ok');
  });

  test('blank queries return empty results without calling sources', async () => {
    const audius = fakeAdapter('audius');
    const result = await setup({ music: [audius] }).search('   ', { limit: 5 });
    expect(result.tracks).toEqual([]);
    expect(audius.searchTracks).not.toHaveBeenCalled();
  });

  test('normalises the cache key and keeps complete results for 5 minutes', async () => {
    let now = 0;
    const audius = fakeAdapter('audius', { searchTracks: vi.fn(async () => [t('audius', 1)]) });
    const catalog = setup({ music: [audius], now: () => now });
    await catalog.search('Lofi', { limit: 5 });
    await catalog.search('  lofi ', { limit: 5 });
    now += 4 * 60_000;
    await catalog.search('LOFI', { limit: 5 });
    expect(audius.searchTracks).toHaveBeenCalledTimes(1);
  });

  test('caches partial results for only 30 seconds', async () => {
    let now = 0;
    const audius = fakeAdapter('audius', { searchTracks: vi.fn(async () => [t('audius', 1)]) });
    const jamendo = fakeAdapter('jamendo', { searchTracks: vi.fn(failing) });
    const catalog = setup({ music: [audius, jamendo], now: () => now });
    await catalog.search('q', { limit: 5 });
    await catalog.search('q', { limit: 5 });
    expect(audius.searchTracks).toHaveBeenCalledTimes(1);
    now += 31_000;
    await catalog.search('q', { limit: 5 });
    expect(audius.searchTracks).toHaveBeenCalledTimes(2);
  });
});

describe('trending', () => {
  test('passes genre and window, and leaves sources without trending disabled', async () => {
    const audius = fakeAdapter('audius', { trending: vi.fn(async () => [t('audius', 1)]) });
    const jamendo = fakeAdapter('jamendo');
    const result = await setup({ music: [audius, jamendo] }).trending({
      genre: 'Lo-Fi',
      window: 'month',
      limit: 5,
    });
    expect(audius.trending).toHaveBeenCalledWith(
      expect.objectContaining({ genre: 'Lo-Fi', window: 'month', limit: 5 }),
    );
    expect(result.tracks.map((x) => x.id)).toEqual(['audius:1']);
    expect(result.sources).toMatchObject({ audius: 'ok', jamendo: 'disabled' });
  });
});

describe('single entities', () => {
  test('getTrack routes by id prefix, caches, and rejects unknown ids with NOT_FOUND', async () => {
    const audius = fakeAdapter('audius', {
      getTrack: vi.fn(async (id: string) => (id === '1' ? t('audius', 1) : null)),
    });
    const catalog = setup({ music: [audius] });
    await expect(catalog.getTrack('audius:1')).resolves.toMatchObject({ id: 'audius:1' });
    await catalog.getTrack('audius:1');
    expect(audius.getTrack).toHaveBeenCalledTimes(1);
    await expect(catalog.getTrack('audius:2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getTrack('jamendo:1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getTrack('garbage')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('missing capabilities mean NOT_FOUND for entities and [] for lists', async () => {
    const catalog = setup({ radio: fakeRadio() });
    await expect(catalog.getArtist('radio:x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getCollection('radio:x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getArtistTracks('radio:x', { limit: 5 })).resolves.toEqual([]);
    await expect(catalog.getRelatedArtists('radio:x', { limit: 5 })).resolves.toEqual([]);
  });

  test('resolveStream is never cached', async () => {
    const audius = fakeAdapter('audius');
    const catalog = setup({ music: [audius] });
    await catalog.resolveStream('audius:1');
    await catalog.resolveStream('audius:1');
    expect(audius.resolveStream).toHaveBeenCalledTimes(2);
  });
});

describe('getLyrics', () => {
  test('skips live tracks, passes track metadata, and caches misses', async () => {
    const song: Track = {
      ...t('audius', 1, 'Daft Punk', 'One More Time'),
      durationSec: 320,
      album: { id: 'audius:al', title: 'Discovery' },
    };
    const audius = fakeAdapter('audius', { getTrack: vi.fn(async () => song) });
    const radio = fakeRadio({ getTrack: vi.fn(async () => live) });
    const lyrics: LyricsClient = { getLyrics: vi.fn(async () => null) };
    const catalog = setup({ music: [audius], radio, lyrics });

    expect(await catalog.getLyrics('radio:s1')).toBeNull();
    expect(lyrics.getLyrics).not.toHaveBeenCalled();

    expect(await catalog.getLyrics('audius:1')).toBeNull();
    await catalog.getLyrics('audius:1');
    expect(lyrics.getLyrics).toHaveBeenCalledTimes(1);
    expect(lyrics.getLyrics).toHaveBeenCalledWith(
      { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', durationSec: 320 },
      expect.anything(),
    );
  });
});

describe('radio', () => {
  test('radioTop and radioSearch delegate to the radio adapter, or return [] without one', async () => {
    const radio = fakeRadio({ searchTracks: vi.fn(async () => [live]) });
    const catalog = setup({ radio });
    expect(await catalog.radioTop({ tag: 'jazz', limit: 3 })).toEqual([live]);
    expect(radio.top).toHaveBeenCalledWith(expect.objectContaining({ tag: 'jazz', limit: 3 }));
    expect(await catalog.radioSearch('lofi', { limit: 3 })).toEqual([live]);
    expect(await setup().radioTop({ limit: 3 })).toEqual([]);
    expect(await catalog.radioSearch('  ', { limit: 3 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @riff/catalog exec vitest run src/merge.test.ts src/aggregator.test.ts`
Expected: FAIL, because `./merge` and `./aggregator` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/catalog/src/merge.ts`:
```ts
import type { SourceId, Track } from '@riff/core';

/** Round-robin merge that preserves each list's own order. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) result.push(list[i] as T);
    }
  }
  return result;
}

const BRACKETED_FEATURE = /[([]\s*(?:feat|ft)\.?\s[^)\]]*[)\]]/g;
const TRAILING_FEATURE = /\s(?:feat|ft)\.?\s.*$/;

/** Lowercase, accent-free, punctuation-free text with feature credits removed. */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(BRACKETED_FEATURE, ' ')
    .replace(TRAILING_FEATURE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function dedupeKey(track: Track): string {
  return `${normalizeForMatch(track.artists[0]?.name ?? '')}|${normalizeForMatch(track.title)}`;
}

/**
 * Removes repeated ids and tracks that an earlier track from a *different* source
 * already covers. Same-source near-duplicates (e.g. remixes) are kept.
 */
export function dedupeAcrossSources(tracks: readonly Track[]): Track[] {
  const seenIds = new Set<string>();
  const sourceByKey = new Map<string, SourceId>();
  const result: Track[] = [];
  for (const track of tracks) {
    if (seenIds.has(track.id)) continue;
    const key = dedupeKey(track);
    const firstSource = sourceByKey.get(key);
    if (firstSource && firstSource !== track.source) continue;
    seenIds.add(track.id);
    sourceByKey.set(key, track.source);
    result.push(track);
  }
  return result;
}
```

`packages/catalog/src/aggregator.ts`:
```ts
import {
  type Artist,
  type Collection,
  type Lyrics,
  parseEntityId,
  SOURCE_IDS,
  type SourceId,
  type StreamInfo,
  type Track,
  type TrendingWindow,
} from '@riff/core';
import type { RadioAdapter, SourceAdapter } from './adapter';
import type { Cache } from './cache';
import { CatalogError, isCatalogError } from './errors';
import type { LyricsClient } from './lyrics/lrclib';
import { dedupeAcrossSources, interleave } from './merge';

export type SourceStatus = 'ok' | 'error' | 'timeout' | 'disabled';
export type SourceStatuses = Record<SourceId, SourceStatus>;

export interface SearchResult {
  tracks: Track[];
  artists: Artist[];
  collections: Collection[];
  /** Live radio stations; never mixed into `tracks`. */
  stations: Track[];
  sources: SourceStatuses;
}

export interface TrendingResult {
  tracks: Track[];
  sources: SourceStatuses;
}

export interface Catalog {
  search(query: string, options: { limit: number }): Promise<SearchResult>;
  trending(options: { genre?: string; window?: TrendingWindow; limit: number }): Promise<TrendingResult>;
  /** Single-entity reads reject with CatalogError NOT_FOUND for unknown or invalid ids. */
  getTrack(id: string): Promise<Track>;
  getArtist(id: string): Promise<Artist>;
  getArtistTracks(id: string, options: { limit: number }): Promise<Track[]>;
  getRelatedArtists(id: string, options: { limit: number }): Promise<Artist[]>;
  getCollection(id: string): Promise<Collection>;
  resolveStream(id: string): Promise<StreamInfo>;
  /** null for live tracks and when no lyrics exist. */
  getLyrics(id: string): Promise<Lyrics | null>;
  radioTop(options: { tag?: string; limit: number }): Promise<Track[]>;
  radioSearch(query: string, options: { limit: number }): Promise<Track[]>;
}

export interface AggregatorDeps {
  music: readonly SourceAdapter[];
  radio: RadioAdapter | null;
  lyrics: LyricsClient;
  cache: Cache;
  /** Per-source budget for fan-out calls (search, trending). Default 3000 ms. */
  searchTimeoutMs?: number;
  /** Budget for single-entity calls. Default 8000 ms. */
  entityTimeoutMs?: number;
  /** Called when a source fails during fan-out; the request itself still succeeds. */
  onSourceError?: (source: SourceId, error: unknown) => void;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const CACHE_TTL = {
  search: 5 * MINUTE,
  trending: 10 * MINUTE,
  entity: HOUR,
  lyricsFound: 24 * HOUR,
  lyricsMissing: 6 * HOUR,
  /** Results where some source failed are retried soon. */
  partial: 30_000,
} as const;

type Loader<T> = (
  adapter: SourceAdapter,
  nativeId: string,
  signal: AbortSignal,
) => Promise<T> | undefined;

export function createAggregator(deps: AggregatorDeps): Catalog {
  const searchTimeoutMs = deps.searchTimeoutMs ?? 3000;
  const entityTimeoutMs = deps.entityTimeoutMs ?? 8000;
  const adapters = new Map<SourceId, SourceAdapter>();
  for (const adapter of deps.music) adapters.set(adapter.id, adapter);
  if (deps.radio) adapters.set(deps.radio.id, deps.radio);

  const fanoutSignal = () => AbortSignal.timeout(searchTimeoutMs);
  const entitySignal = () => AbortSignal.timeout(entityTimeoutMs);

  function settle<T>(source: SourceId, result: PromiseSettledResult<T>, fallback: T) {
    if (result.status === 'fulfilled') return { status: 'ok' as SourceStatus, value: result.value };
    deps.onSourceError?.(source, result.reason);
    const status: SourceStatus = isCatalogError(result.reason, 'UPSTREAM_TIMEOUT')
      ? 'timeout'
      : 'error';
    return { status, value: fallback };
  }

  function resolve(id: string): { adapter: SourceAdapter; nativeId: string } {
    const parsed = parseEntityId(id);
    const adapter = parsed ? adapters.get(parsed.source) : undefined;
    if (!parsed || !adapter) throw notFound(id);
    return { adapter, nativeId: parsed.nativeId };
  }

  function cachedEntity<T>(key: string, id: string, load: Loader<T | null>): Promise<T> {
    return deps.cache.getOrSet(key, CACHE_TTL.entity, async () => {
      const { adapter, nativeId } = resolve(id);
      const value = await load(adapter, nativeId, entitySignal());
      if (value == null) throw notFound(id);
      return value;
    });
  }

  function cachedList<T>(key: string, id: string, load: Loader<T[]>): Promise<T[]> {
    return deps.cache.getOrSet(key, CACHE_TTL.entity, async () => {
      const { adapter, nativeId } = resolve(id);
      return (await load(adapter, nativeId, entitySignal())) ?? [];
    });
  }

  const getTrack = (id: string) =>
    cachedEntity<Track>(`track:${id}`, id, (adapter, nativeId, signal) =>
      adapter.getTrack(nativeId, { signal }),
    );

  return {
    async search(query, { limit }) {
      const q = query.trim();
      if (!q) return { tracks: [], artists: [], collections: [], stations: [], sources: allDisabled() };

      return deps.cache.getOrSet<SearchResult>(
        `search:${limit}:${q.toLowerCase()}`,
        ttlUnlessPartial(CACHE_TTL.search),
        async () => {
          const sources = allDisabled();
          const music = Promise.all(
            deps.music.map(async (adapter) => {
              const options = { limit, signal: fanoutSignal() };
              const [tracks, artists, collections] = await Promise.allSettled([
                adapter.searchTracks(q, options),
                adapter.searchArtists?.(q, options) ?? [],
                adapter.searchCollections?.(q, options) ?? [],
              ]);
              const settledTracks = settle(adapter.id, tracks, []);
              sources[adapter.id] = settledTracks.status;
              return {
                tracks: settledTracks.value,
                artists: artists.status === 'fulfilled' ? artists.value : [],
                collections: collections.status === 'fulfilled' ? collections.value : [],
              };
            }),
          );
          const radio = deps.radio;
          const stations = radio
            ? Promise.allSettled([radio.searchTracks(q, { limit, signal: fanoutSignal() })]).then(
                ([result]) => {
                  const settled = settle(radio.id, result, []);
                  sources[radio.id] = settled.status;
                  return settled.value;
                },
              )
            : Promise.resolve<Track[]>([]);

          const [perSource, stationTracks] = await Promise.all([music, stations]);
          return {
            tracks: dedupeAcrossSources(interleave(perSource.map((r) => r.tracks))).slice(0, limit),
            artists: interleave(perSource.map((r) => r.artists)).slice(0, limit),
            collections: interleave(perSource.map((r) => r.collections)).slice(0, limit),
            stations: stationTracks,
            sources,
          };
        },
      );
    },

    async trending({ genre, window = 'week', limit }) {
      return deps.cache.getOrSet<TrendingResult>(
        `trending:${genre ?? '*'}:${window}:${limit}`,
        ttlUnlessPartial(CACHE_TTL.trending),
        async () => {
          const sources = allDisabled();
          const lists = await Promise.all(
            deps.music.map(async (adapter) => {
              if (!adapter.trending) return [];
              const [result] = await Promise.allSettled([
                adapter.trending({ genre, window, limit, signal: fanoutSignal() }),
              ]);
              const settled = settle(adapter.id, result, []);
              sources[adapter.id] = settled.status;
              return settled.value;
            }),
          );
          return { tracks: dedupeAcrossSources(interleave(lists)).slice(0, limit), sources };
        },
      );
    },

    getTrack,

    getArtist: (id) =>
      cachedEntity<Artist>(`artist:${id}`, id, (adapter, nativeId, signal) =>
        adapter.getArtist?.(nativeId, { signal }),
      ),

    getArtistTracks: (id, { limit }) =>
      cachedList<Track>(`artist-tracks:${id}:${limit}`, id, (adapter, nativeId, signal) =>
        adapter.getArtistTracks?.(nativeId, { limit, signal }),
      ),

    getRelatedArtists: (id, { limit }) =>
      cachedList<Artist>(`related:${id}:${limit}`, id, (adapter, nativeId, signal) =>
        adapter.getRelatedArtists?.(nativeId, { limit, signal }),
      ),

    getCollection: (id) =>
      cachedEntity<Collection>(`collection:${id}`, id, (adapter, nativeId, signal) =>
        adapter.getCollection?.(nativeId, { signal }),
      ),

    async resolveStream(id) {
      const { adapter, nativeId } = resolve(id);
      return adapter.resolveStream(nativeId, { signal: entitySignal() });
    },

    async getLyrics(id) {
      const track = await getTrack(id);
      if (track.isLive) return null;
      return deps.cache.getOrSet<Lyrics | null>(
        `lyrics:${id}`,
        (lyrics) => (lyrics ? CACHE_TTL.lyricsFound : CACHE_TTL.lyricsMissing),
        () =>
          deps.lyrics.getLyrics(
            {
              title: track.title,
              artist: track.artists[0]?.name ?? '',
              album: track.album?.title,
              durationSec: track.durationSec,
            },
            { signal: entitySignal() },
          ),
      );
    },

    async radioTop({ tag, limit }) {
      const radio = deps.radio;
      if (!radio) return [];
      return deps.cache.getOrSet(`radio-top:${tag ?? '*'}:${limit}`, CACHE_TTL.trending, () =>
        radio.top({ tag, limit, signal: entitySignal() }),
      );
    },

    async radioSearch(query, { limit }) {
      const radio = deps.radio;
      const q = query.trim();
      if (!radio || !q) return [];
      return deps.cache.getOrSet(`radio-search:${limit}:${q.toLowerCase()}`, CACHE_TTL.search, () =>
        radio.searchTracks(q, { limit, signal: entitySignal() }),
      );
    },
  };
}

function allDisabled(): SourceStatuses {
  return Object.fromEntries(SOURCE_IDS.map((id) => [id, 'disabled'])) as SourceStatuses;
}

function ttlUnlessPartial(ttl: number) {
  return (result: { sources: SourceStatuses }): number =>
    Object.values(result.sources).some((s) => s === 'error' || s === 'timeout')
      ? CACHE_TTL.partial
      : ttl;
}

function notFound(id: string): CatalogError {
  return new CatalogError('NOT_FOUND', `Nothing found for ${id}`);
}
```

Add to `packages/catalog/src/index.ts`:
```ts
export {
  type AggregatorDeps,
  CACHE_TTL,
  type Catalog,
  createAggregator,
  type SearchResult,
  type SourceStatus,
  type SourceStatuses,
  type TrendingResult,
} from './aggregator';
export { dedupeAcrossSources, interleave, normalizeForMatch } from './merge';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): add aggregator with fan-out, cross-source dedupe and caching

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Catalog factory, live checks and project guide

**Files:**
- Create: `packages/catalog/src/create-catalog.ts`, `packages/catalog/src/live.test.ts`
- Modify: `packages/catalog/src/index.ts`, `CLAUDE.md`
- Test: `packages/catalog/src/create-catalog.test.ts`

**Interfaces:**
- Consumes: every earlier catalog export.
- Produces (what Plan 2's API consumes):
  - `DEFAULT_USER_AGENT = 'Riff/0.1 (personal music player)'`
  - `interface CatalogConfig { userAgent; audius: AudiusConfig; jamendo: JamendoConfig | null; radio: RadioConfig | null; lrclibUrl?; fetch?; searchTimeoutMs?; entityTimeoutMs?; onSourceError? }`
  - `catalogConfigFromEnv(env: Readonly<Record<string, string | undefined>>): CatalogConfig`
  - `createCatalog(config: CatalogConfig, cache?: Cache): Catalog`

- [ ] **Step 1: Write the failing test**

`packages/catalog/src/create-catalog.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { catalogConfigFromEnv, createCatalog, DEFAULT_USER_AGENT } from './create-catalog';
import { rawTrack } from './sources/audius/fixtures';
import { rawStation } from './sources/radio/fixtures';
import { fakeFetch } from './testing/fake-fetch';

describe('catalogConfigFromEnv', () => {
  test('uses defaults and leaves Jamendo off without a client id', () => {
    expect(catalogConfigFromEnv({})).toEqual({
      userAgent: DEFAULT_USER_AGENT,
      audius: { apiUrl: 'https://api.audius.co', appName: 'riff' },
      jamendo: null,
      radio: { servers: ['de1', 'de2'] },
    });
  });

  test('reads overrides, enables Jamendo, and disables radio with an empty server list', () => {
    const config = catalogConfigFromEnv({
      AUDIUS_API_URL: 'https://audius.test',
      AUDIUS_APP_NAME: 'mine',
      JAMENDO_CLIENT_ID: 'abc',
      RADIO_BROWSER_SERVERS: ' de2 , ',
    });
    expect(config.audius).toEqual({ apiUrl: 'https://audius.test', appName: 'mine' });
    expect(config.jamendo).toEqual({ clientId: 'abc' });
    expect(config.radio).toEqual({ servers: ['de2'] });
    expect(catalogConfigFromEnv({ RADIO_BROWSER_SERVERS: '' }).radio).toBeNull();
  });
});

describe('createCatalog', () => {
  test('wires Audius and radio and reports Jamendo as disabled without a key', async () => {
    const fetch = fakeFetch([
      { match: 'api.audius.co/v1/tracks/search', json: { data: [rawTrack()] } },
      { match: 'api.audius.co/v1/users/search', json: { data: [] } },
      { match: 'api.audius.co/v1/playlists/search', json: { data: [] } },
      { match: 'api.radio-browser.info/json/stations/search', json: [rawStation()] },
    ]);
    const catalog = createCatalog({ ...catalogConfigFromEnv({}), fetch });
    const result = await catalog.search('lofi', { limit: 5 });
    expect(result.sources).toEqual({ audius: 'ok', jamendo: 'disabled', radio: 'ok' });
    expect(result.tracks).toHaveLength(1);
    expect(result.stations).toHaveLength(1);
    expect(fetch.unmatched).toEqual([]);
    expect(fetch.requests[0]!.headers.get('user-agent')).toBe(DEFAULT_USER_AGENT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @riff/catalog exec vitest run src/create-catalog.test.ts`
Expected: FAIL, because `./create-catalog` cannot be resolved.

- [ ] **Step 3: Implement the factory and the live suite**

`packages/catalog/src/create-catalog.ts`:
```ts
import type { SourceId } from '@riff/core';
import type { SourceAdapter } from './adapter';
import { type Catalog, createAggregator } from './aggregator';
import { type Cache, createMemoryCache } from './cache';
import { createHttpClient, type FetchLike } from './http';
import { createLrclibClient } from './lyrics/lrclib';
import { type AudiusConfig, createAudiusAdapter } from './sources/audius/adapter';
import { createJamendoAdapter, type JamendoConfig } from './sources/jamendo/adapter';
import { createRadioAdapter, type RadioConfig } from './sources/radio/adapter';

export const DEFAULT_USER_AGENT = 'Riff/0.1 (personal music player)';

export interface CatalogConfig {
  userAgent: string;
  audius: AudiusConfig;
  /** null disables Jamendo (no client id). */
  jamendo: JamendoConfig | null;
  /** null disables radio. */
  radio: RadioConfig | null;
  lrclibUrl?: string;
  fetch?: FetchLike;
  searchTimeoutMs?: number;
  entityTimeoutMs?: number;
  onSourceError?: (source: SourceId, error: unknown) => void;
}

export function catalogConfigFromEnv(env: Readonly<Record<string, string | undefined>>): CatalogConfig {
  const servers = (env.RADIO_BROWSER_SERVERS ?? 'de1,de2')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  return {
    userAgent: DEFAULT_USER_AGENT,
    audius: {
      apiUrl: env.AUDIUS_API_URL || 'https://api.audius.co',
      appName: env.AUDIUS_APP_NAME || 'riff',
    },
    jamendo: env.JAMENDO_CLIENT_ID ? { clientId: env.JAMENDO_CLIENT_ID } : null,
    radio: servers.length > 0 ? { servers } : null,
  };
}

export function createCatalog(config: CatalogConfig, cache: Cache = createMemoryCache()): Catalog {
  const http = createHttpClient({ fetch: config.fetch, userAgent: config.userAgent });
  const music: SourceAdapter[] = [createAudiusAdapter({ http, config: config.audius })];
  if (config.jamendo) music.push(createJamendoAdapter({ http, config: config.jamendo }));
  return createAggregator({
    music,
    radio: config.radio ? createRadioAdapter({ http, config: config.radio }) : null,
    lyrics: createLrclibClient({ http, baseUrl: config.lrclibUrl }),
    cache,
    searchTimeoutMs: config.searchTimeoutMs,
    entityTimeoutMs: config.entityTimeoutMs,
    onSourceError: config.onSourceError,
  });
}
```

`packages/catalog/src/live.test.ts`:
```ts
import { TrackSchema } from '@riff/core';
import { describe, expect, test } from 'vitest';
import { catalogConfigFromEnv, createCatalog, DEFAULT_USER_AGENT } from './create-catalog';
import { createHttpClient } from './http';
import { createLrclibClient } from './lyrics/lrclib';

// Hits the real upstreams. Run with: pnpm --filter @riff/catalog test:live
describe.skipIf(!process.env.LIVE)('live upstreams', { timeout: 60_000 }, () => {
  const catalog = createCatalog(catalogConfigFromEnv(process.env));

  test('Audius trending tracks are schema-valid and their streams serve audio', async () => {
    const { tracks, sources } = await catalog.trending({ limit: 5 });
    expect(sources.audius).toBe('ok');
    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) TrackSchema.parse(track);

    const stream = await catalog.resolveStream(tracks[0]!.id);
    const response = await fetch(stream.url, { headers: { range: 'bytes=0-1023' } });
    expect([200, 206]).toContain(response.status);
    expect(response.headers.get('content-type')).toMatch(/^audio\//);
    await response.body?.cancel();
  });

  test('artist pages and collections resolve', async () => {
    const { tracks } = await catalog.trending({ limit: 1 });
    const artistId = tracks[0]!.artists[0]!.id;
    expect((await catalog.getArtist(artistId)).name.length).toBeGreaterThan(0);
    expect((await catalog.getArtistTracks(artistId, { limit: 5 })).length).toBeGreaterThan(0);
    expect(Array.isArray(await catalog.getRelatedArtists(artistId, { limit: 5 }))).toBe(true);

    const { collections } = await catalog.search('chill', { limit: 5 });
    expect(collections.length).toBeGreaterThan(0);
    const collection = await catalog.getCollection(collections[0]!.id);
    expect(Array.isArray(collection.tracks)).toBe(true);
  });

  test('Jamendo answers when a client id is configured', async () => {
    if (!process.env.JAMENDO_CLIENT_ID) return;
    const { sources, tracks } = await catalog.search('piano', { limit: 10 });
    expect(sources.jamendo).toBe('ok');
    expect(tracks.some((t) => t.source === 'jamendo')).toBe(true);
  });

  test('radio returns playable https stations', async () => {
    const stations = await catalog.radioTop({ limit: 5 });
    expect(stations.length).toBeGreaterThan(0);
    for (const station of stations) expect(station.isLive).toBe(true);
    const stream = await catalog.resolveStream(stations[0]!.id);
    expect(stream.url).toMatch(/^https:\/\//);
  });

  test('LRCLIB returns synced lyrics for a well-known song', async () => {
    const lyrics = createLrclibClient({ http: createHttpClient({ userAgent: DEFAULT_USER_AGENT }) });
    const result = await lyrics.getLyrics({ title: 'One More Time', artist: 'Daft Punk' });
    expect(result?.synced?.length ?? 0).toBeGreaterThan(0);
  });
});
```

Add to `packages/catalog/src/index.ts`:
```ts
export {
  type CatalogConfig,
  catalogConfigFromEnv,
  createCatalog,
  DEFAULT_USER_AGENT,
} from './create-catalog';
```

- [ ] **Step 4: Run the unit and live tests**

Run: `pnpm --filter @riff/catalog test && pnpm --filter @riff/catalog typecheck`
Expected: PASS. The live suite shows as skipped.

Run: `set -a && . ./.env && set +a && pnpm --filter @riff/catalog test:live`
Expected: PASS (5 tests; the Jamendo test returns early without a key). If an upstream shape has changed, fix the mapper and add a matching case to that adapter's unit tests before continuing.

- [ ] **Step 5: Update `CLAUDE.md`**

Insert this block at the very top of `CLAUDE.md`, above the existing `# Dual-Graph Context Policy` heading, and keep everything that is already there:

```markdown
# Riff: project guide

A free, Spotify-like music app used as a personal daily driver (web now, Expo mobile later).
Uses legal sources only: Audius (primary, no key), Jamendo (optional key), Radio Browser, and LRCLIB lyrics.
Never add YouTube-scraping sources.

- Spec: `docs/superpowers/specs/2026-09-27-riff-v1-design.md`
- Plans: `docs/superpowers/plans/`. Plan 1 (foundation) is done; Plan 2 (db + api) and Plan 3 (web) are next.

## Layout
- `packages/core`: domain types + zod schemas, entity ids, LRC parser, and the queue state machine (exported as `queue`). Pure: no I/O; randomness and ids are injected via `QueueEnv`.
- `packages/catalog`: source adapters (`src/sources/*`), the aggregator (fan-out, cross-source dedupe, cache), and the LRCLIB client. Uses Web APIs only; no `node:` imports outside tests.
- Coming in Plan 2: `packages/db` (Drizzle), `packages/api` (Hono). Coming in Plan 3: `apps/web` (Next.js, which mounts the API at `/api`).

## Commands (from the repo root)
- `pnpm install`
- `pnpm test`: all unit tests via Turbo
- `pnpm typecheck`, `pnpm lint`, `pnpm format`
- `set -a && . ./.env && set +a && pnpm --filter @riff/catalog test:live`: checks the real upstream APIs

## Conventions
- TypeScript is strict with `noUncheckedIndexedAccess`. Packages export TS source (`exports: ./src/index.ts`) and have no build step.
- Dependency versions are pinned once in `pnpm-workspace.yaml` under `catalog:`; reference them as `"catalog:"`.
- Entity ids look like `source:nativeId`: `audius:NQwXON0`, `jamendo:album:42`, `radio:<uuid>`. User playlist ids are UUIDs.
- Tests are Vitest files colocated as `*.test.ts`. Unit tests never touch the network; use `packages/catalog/src/testing/fake-fetch.ts`.
- Upstream quirks:
  - Audius returns 400 (not 404) for unknown ids.
  - Audius trending windows are `week | month | allTime`.
  - Radio streams must be https and non-HLS.
- Local database: native Postgres 16, with role and databases `riff` / `riff_test` (password `riff`). Env vars live in the root `.env`; see `.env.example`.

```

- [ ] **Step 6: Run the full verification**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: all clean. Turbo reports `@riff/core` and `@riff/catalog` test and typecheck tasks as successful.

- [ ] **Step 7: Commit**

```bash
git add packages/catalog CLAUDE.md
git commit -m "feat(catalog): add env-driven catalog factory, live upstream checks and project guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
