# Riff Plan 3: Web app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/web`, the Next.js app that mounts `@riff/api` at `/api`, plays music through a tested audio engine and player store, and gives every route in spec §9 a working, responsive UI.

**Architecture:**
- **One Next.js 16 app.** `app/api/[[...route]]/route.ts` builds the Hono API on the first request. `proxy.ts` sends visitors without a session cookie to `/sign-in?next=…`. Pages are client components over TanStack Query and the typed `hc` client, and the server renders only the shell.
- **The player lives outside React.**
  - `lib/player/engine.ts` owns one `<audio>` element: stream resolution, mirror failover, one re-resolve, a stall watchdog and prefetch.
  - `lib/player/player.ts` is a Zustand store that runs `@riff/core`'s queue reducer and turns its effects into engine calls. It also records history and stops after repeated failures.
  - Around them sit persistence (`riff:player:v1`), Media Session and keyboard shortcuts.
  - `lib/player/instance.ts` holds the app's one `player`. Components read it with `usePlayer(selector)`.
- **UI.**
  - Tailwind v4 tokens: warm near-black surfaces, one ember accent.
  - Radix primitives (the `radix-ui` package), styled in the shadcn way.
  - A virtualised `TrackList` that scrolls with the window.
  - dnd-kit for the queue and for playlist reordering.
  - Layouts: desktop (sidebar, page, optional panel, player bar), tablet (icon rail), phone (tab bar, mini-player, full-screen Now Playing).

**Tech Stack:** Plans 1 and 2, plus:
- next 16.3.6, react and react-dom 19.3.0, geist 1.7.2
- tailwindcss and @tailwindcss/postcss 4.3.3, radix-ui 1.6.7, lucide-react 1.48.0, sonner 2.0.8, clsx 2.1.1, tailwind-merge 3.7.0
- @tanstack/react-query 5.104.0, @tanstack/react-virtual 3.14.13, zustand 5.0.15
- @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, @dnd-kit/modifiers 9.0.0, @dnd-kit/utilities 3.2.2
- Tests: jsdom 30.1.1, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.7, @testing-library/jest-dom 7.0.1, @playwright/test 1.63.0

**Spec:** `docs/superpowers/specs/2026-09-27-riff-v1-design.md`: §8 (player), §9 (web app), §10 (error handling), §11 (testing), §12 (environments). This plan consumes Plan 1's `@riff/core` and Plan 2's `@riff/api` (`docs/superpowers/plans/2026-09-27-riff-plan-2-backend.md`, "Handoff to Plan 3"). Task 1 changes `@riff/core`; Task 14 adds Vercel preview origins to `@riff/api`.

**Verified before writing:** every file below was built and run in a scratch clone of this repo on 2026-09-28, on this machine (Node 24.16, pnpm 12.6.0, Postgres 16.15, Google Chrome).
- `pnpm test --force` passes: core 70, catalog 83 (+5 skipped), db 8, api 113 (+1 skipped), web 245.
- `pnpm typecheck`, `pnpm lint` and `pnpm build` are clean.
- `pnpm test:e2e` passes 4/4, including both `@live` tests against the real Audius API.
- The UI was checked in Chrome at 1440 px, 1280 px and 390 px: Home, Search, an artist page, radio (a live station playing), a playlist with keyboard reorder, and Liked Songs.

## Global Constraints

- Plans 1 and 2's Global Constraints still apply. That includes: commit after every task with a conventional commit message and **no `Co-Authored-By` trailer**.
- New dependency versions are pinned once in `pnpm-workspace.yaml` under `catalog:` (Task 2 lists them). pnpm 12 needs no new `allowBuilds` entries for them.
- TypeScript stays at 7.0.2: Next.js 16.3.6 builds and type-checks under it, so the `typescript@6` fallback from the Plan 2 handoff is not needed. `typecheck` runs `next typegen` first, because `next-env.d.ts` (gitignored) imports the generated `.next/types`.
- Next 16 conventions:
  - The middleware file is `proxy.ts`, exporting `proxy`.
  - Page props use the global `PageProps<'/route'>`, with `searchParams` as a Promise.
  - `next dev` writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`, which are committed (Task 2).
- `packages/api` still imports nothing from Next.js. In `apps/web`, only server files (`next.config.ts`, the API route, `proxy.ts`, Playwright files) touch Node APIs.
- Visual direction (spec §9):
  - Dark only, with the tokens in `app/globals.css` (one ember accent, never Spotify green).
  - Shapes: interactive controls are pills; panels and menus are `rounded-xl`/`2xl`; artwork is `rounded-md` (artists `rounded-full`).
  - Every control is keyboard reachable with a visible focus ring. Motion respects `prefers-reduced-motion`.
  - UI copy uses typographic quotes and apostrophes (’ “ ”) and no em dashes.
- Player numbers (spec §8):
  - ←/→ seek 5 s, and "previous" restarts the track after 3 s.
  - Volume is slider² (`toGain`).
  - History: one `POST /me/history` per play, once 30 s have been heard, or on `ended` for a shorter track. Heard means playing and not muted.
  - Persistence key `riff:player:v1`: saved every 5 s when something changed and on `pagehide`; restored paused.
  - A stream that sends no audio for 15 s counts as failed. After 3 failed tracks in a row, playback stops.
- Tests:
  - Web unit and component tests are Vitest with jsdom, colocated as `*.test.ts(x)`. They never touch the network: `test/api-stub.ts` stubs `fetch`.
  - Playwright runs only through `pnpm test:e2e`, against a production build on :3200 and `riff_test`.
- Blank optional query params are 400 at the API: the client omits them (`undefined`), never sends `''`. Query values in the typed client are strings (`limit: '20'`).

## Review Focus

1. **A stream that stalls or dies mid-track** (an expired signature, a flaky Audius content node, a radio server that accepts the connection but sends nothing). Failover goes mirror → one fresh resolution → toast and skip. The player never spins forever, and never skips through the whole queue when the network is down. Pinned in:
   - Task 4: `a source that never starts playing counts as failed`, `when every mirror fails, resolves again once and resumes where it was`, `recovers from a second expiry later in the same track`
   - Task 5: `stops instead of skipping through the whole queue when nothing plays`
2. **A reload mid-song, and a corrupt or outdated saved queue.** The player restores paused at the saved position and loads audio only on play. An unreadable save is discarded whole, never half-restored. Pinned in:
   - Task 1: `QueueStateSchema` rejects each broken invariant
   - Task 6: `drops %s and removes it`, `restores the saved queue paused at its position`, `a full or disabled storage does not break playback`
3. **Keys that belong to something else.** Typing in the search box, Space on a focused button, arrow keys on a slider or in a menu, and Ctrl/⌘ shortcuts all leave the player alone. Pinned in:
   - Task 6: `ignores keys typed into a %s`, `Space on a focused button presses the button instead`, `keys a widget already handled are left alone`
4. **An expired session, a stale cookie and a hostile `?next=`.** Any 401 sends the user to `/sign-in?next=<page>`. A stale cookie never causes a redirect loop, and `next` can never leave the site. Pinned in:
   - Task 3: `calls the unauthorized handler on 401`, `falls back to / for %j`, `lets requests with a session cookie through`, `skips /sign-in`
   - Task 14: `signed-out visitors are sent to sign-in and brought back after`
5. **A 360 px phone and live radio.** No sideways scrolling on any page. Live stations show LIVE instead of a seek bar, and cannot seek or go back. Pinned in:
   - Task 14: `pages fit a 360 px phone without sideways scrolling, and hydrate cleanly`
   - Task 8: `previous is disabled for live stations`, `shows LIVE instead of a bar for stations`
   - Task 5: `live stations cannot seek or go back`

---

## File Structure

```
package.json                     + test:e2e (Task 14)
pnpm-workspace.yaml              + web catalog versions (Task 2)
turbo.json                       runtime env for build/dev (Task 2)
biome.json                       Tailwind CSS directives (Task 2)
.gitignore                       + next-env.d.ts (Task 2)
README.md, CLAUDE.md             web app, e2e, deploy notes (Task 14)
docs/superpowers/specs/…         spec aligned with Plan 3 decisions (Task 14)
packages/core/src/queue/         NaN start index, wrap anchor, QueueStateSchema (Task 1)
packages/api/src/config.ts,auth.ts   trust Vercel preview origins (Task 14)
apps/web/
  package.json, tsconfig.json, next.config.ts, postcss.config.mjs, vitest.config.ts
  AGENTS.md, CLAUDE.md           written by `next dev`; committed as-is
  playwright.config.ts, e2e/     end-to-end tests (Task 14)
  proxy.ts                       signed-out visitors → /sign-in?next=
  app/
    layout.tsx, globals.css, icon.svg        root: fonts, tokens, reduced motion
    api/[[...route]]/route.ts                the API, built on first request
    (auth)/layout.tsx, sign-in/, sign-up/    auth pages
    (app)/layout.tsx                         providers, player runtime, shortcuts, shell
    (app)/page.tsx                           Home
    (app)/{search,genre/[genre],artist/[id],collection/[id],playlist/[id],liked,radio,library}/page.tsx
  lib/
    api.ts, redirect.ts, auth-client.ts, cn.ts, format.ts, color.ts
    query-client.ts, ui-store.ts, route-param.ts, use-dominant-color.ts
    queries/{keys,catalog,library,playlists}.ts   TanStack Query hooks
    player/
      engine.ts          <audio>: resolve, mirrors, re-resolve, watchdog, prefetch
      player.ts          store + actions: queue reducer effects, failures, history
      play-tracker.ts    audible time → one history POST per play
      persistence.ts     riff:player:v1
      media-session.ts   OS media controls
      shortcuts.ts       keyboard map + useShortcuts
      remote.ts          stream resolution and history calls
      volume.ts          slider → gain
      instance.ts        the app's player; usePlayer()
  components/
    ui/        button, input, slider, menu, dialog, sheet, tabs, skeleton
    brand/     logo
    auth/      auth-form
    player/    engine runtime, transport, seek bar, volume, now-playing (panel + sheet),
               lyrics panel, queue panel, player bar, mini-player
    tracks/    track list (virtualised), sortable list, row menu, like, equalizer, play button
    media/     artwork, covers, page header, shelf, cards, genre grid, source notice
    shell/     app shell, sidebar, library list, top bar, search field, user menu,
               mobile tab bar, right panel, shortcuts, create-playlist dialog
    playlists/ edit and delete dialogs
    states/    error and empty states
  test/        setup, fixtures, fake media, test player, player mock, api stub, query wrapper
```

Server-state hooks live in `lib/queries/*`, and the player and its browser integrations live in `lib/player/*`. Components hold no fetching logic of their own. A new screen composes hooks with components.

---

### Task 1: `@riff/core`: queue hardening and `QueueStateSchema`

Two Plan 1 review findings matter now that a real player drives the queue:
- **#5:** `playContext(NaN)` corrupts the queue state.
- **#6:** the reshuffle-on-wrap guard compares against `current`. That can be a queued item, so the last context track can open the new cycle.

The player will also restore queue state from `localStorage`, which needs a validating schema.

**Files:**
- Modify: `packages/core/src/queue/queue.ts` (two lines), `packages/core/src/queue/types.ts` (const arrays), `packages/core/src/index.ts`
- Create: `packages/core/src/queue/schema.ts`
- Test: `packages/core/src/queue/queue.navigation.test.ts` (two tests added), `packages/core/src/queue/schema.test.ts`

**Interfaces:**
- Consumes: `TrackSchema` from `packages/core/src/types.ts`.
- Produces (exported from `@riff/core`):
  - `QueueStateSchema`: a zod schema whose output is assignable to `QueueState`. It also checks two invariants: `index < order.length`, and `current` equals `order[index]` unless it came from `upNext`.
  - `REPEAT_MODES`, `QUEUE_CONTEXT_TYPES`: const arrays. `RepeatMode` and `QueueContextType` are now derived from them.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/queue/queue.navigation.test.ts`, add inside `describe('playContext', …)`, before `'ignores an empty context'`:

```ts
  test('treats a NaN start index as the first track', () => {
    const s = q.playContext(q.emptyQueue, tracks(3), Number.NaN, ctx, testEnv());
    expect(currentId(s)).toBe('audius:t1');
    expect(s.index).toBe(0);
  });
```

and inside `describe('next', …)`, before `'stops on an empty queue'`:

```ts
  test('on wrap, never starts the new cycle with the last context track, even after a queued one', () => {
    const base = testEnv();
    const rolls = [0, 0.99]; // shuffles [t1, t2, t3] into [t3, t2, t1]
    const env = { uid: base.uid, rng: () => rolls.shift() ?? 0 };
    let s: QueueState = {
      ...q.playContext(q.emptyQueue, tracks(3), 2, ctx, env),
      shuffle: true,
      repeat: 'all',
    };
    s = q.next(q.addToQueue(s, [track(9)], env), env).state;
    expect(currentId(s)).toBe('audius:t9');
    const step = q.next(s, env);
    expect(step.effect).toBe('play');
    expect(currentId(step.state)).not.toBe('audius:t3');
  });
```

Create the schema test:

`packages/core/src/queue/schema.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import * as q from './queue';
import { QueueStateSchema } from './schema';
import { ctx, testEnv, track, tracks } from './test-helpers';
import type { QueueState } from './types';

const roundTrip = (state: QueueState): unknown => JSON.parse(JSON.stringify(state));

function playing(): QueueState {
  const env = testEnv();
  return q.addToQueue(q.playContext(q.emptyQueue, tracks(3), 1, ctx, env), [track(7)], env);
}

describe('QueueStateSchema', () => {
  test('accepts the empty queue and real states after a JSON round trip', () => {
    const env = testEnv();
    const fromUpNext = q.next(playing(), env).state;
    for (const state of [q.emptyQueue, playing(), fromUpNext]) {
      expect(QueueStateSchema.parse(roundTrip(state))).toEqual(state);
    }
  });

  test.each([
    ['an index past the end of order', (s: QueueState) => ({ ...s, index: s.order.length })],
    ['an index below -1', (s: QueueState) => ({ ...s, index: -2 })],
    ['a current item that is not order[index]', (s: QueueState) => ({ ...s, current: s.order[0] })],
    ['an unknown repeat mode', (s: QueueState) => ({ ...s, repeat: 'forever' })],
    ['an unknown context type', (s: QueueState) => ({ ...s, context: { type: 'x', name: 'x' } })],
    [
      'a malformed track',
      (s: QueueState) => ({ ...s, upNext: [{ uid: 'u9', track: { id: 'nope' } }] }),
    ],
  ])('rejects %s', (_, corrupt) => {
    expect(QueueStateSchema.safeParse(corrupt(roundTrip(playing()) as QueueState)).success).toBe(
      false,
    );
  });

  test('rejects values that are not queue states at all', () => {
    for (const value of [null, 42, 'queue', [], {}]) {
      expect(QueueStateSchema.safeParse(value).success).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm --filter @riff/core exec vitest run src/queue`
Expected:
- `× treats a NaN start index as the first track` (`expected null to be 'audius:t1'`)
- `× on wrap, never starts the new cycle…` (`expected 'audius:t3' not to be 'audius:t3'`)
- `schema.test.ts` fails with `Cannot find module './schema'`

- [ ] **Step 3: Fix the reducer**

In `packages/core/src/queue/queue.ts`, `playContext`, replace

```ts
  const start = Math.min(Math.max(Math.trunc(startIndex), 0), items.length - 1);
```

with

```ts
  const requested = Number.isNaN(startIndex) ? 0 : Math.trunc(startIndex);
  const start = Math.min(Math.max(requested, 0), items.length - 1);
```

and in `next`, replace

```ts
    const order = state.shuffle ? reshuffle(state.order, state.current, env.rng) : state.order;
```

with

```ts
    // Anchor on the last context item, not `current`: that may be a queued item.
    const last = state.order[state.index] ?? null;
    const order = state.shuffle ? reshuffle(state.order, last, env.rng) : state.order;
```

- [ ] **Step 4: Add the const arrays and the schema**

In `packages/core/src/queue/types.ts`, replace the `RepeatMode` and `QueueContextType` type aliases with:

```ts
export const REPEAT_MODES = ['off', 'all', 'one'] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

export const QUEUE_CONTEXT_TYPES = [
  'playlist',
  'collection',
  'artist',
  'liked',
  'search',
  'trending',
  'radio',
  'history',
] as const;
export type QueueContextType = (typeof QUEUE_CONTEXT_TYPES)[number];
```

`packages/core/src/queue/schema.ts`:

```ts
import { z } from 'zod';
import { TrackSchema } from '../types';
import { QUEUE_CONTEXT_TYPES, REPEAT_MODES } from './types';

const QueueItemSchema = z.object({ uid: z.string().min(1), track: TrackSchema });

/**
 * Validates a queue state read back from storage. Beyond the shape, it checks the invariants
 * the reducer relies on, so a corrupt or outdated save is rejected instead of half-restored.
 */
export const QueueStateSchema = z
  .object({
    context: z
      .object({ type: z.enum(QUEUE_CONTEXT_TYPES), id: z.string().optional(), name: z.string() })
      .nullable(),
    original: z.array(QueueItemSchema),
    order: z.array(QueueItemSchema),
    index: z.number().int().min(-1),
    upNext: z.array(QueueItemSchema),
    current: QueueItemSchema.nullable(),
    currentFromUpNext: z.boolean(),
    shuffle: z.boolean(),
    repeat: z.enum(REPEAT_MODES),
  })
  .refine((state) => state.index < state.order.length, 'index is past the end of order')
  .refine(
    (state) =>
      !state.current ||
      state.currentFromUpNext ||
      state.order[state.index]?.uid === state.current.uid,
    'current must be order[index] unless it came from upNext',
  );
```

`packages/core/src/index.ts`:

```ts
export * from './genres';
export * from './ids';
export * from './lyrics';
export * as queue from './queue/queue';
export { QueueStateSchema } from './queue/schema';
export { shuffled } from './queue/shuffle';
export type * from './queue/types';
export { QUEUE_CONTEXT_TYPES, REPEAT_MODES } from './queue/types';
export * from './types';
```

- [ ] **Step 5: Run the core suite**

Run: `pnpm --filter @riff/core test && pnpm --filter @riff/core typecheck`
Expected: `Tests  70 passed (70)` (60 before, plus 2 queue tests and 8 schema tests), and no type errors.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add packages/core
git commit -m "fix(core): harden queue start index and wrap reshuffle; add QueueStateSchema"
```

### Task 2: `apps/web` scaffold: Next.js, Tailwind tokens and the API mount

**Files:**
- Modify: `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `.gitignore`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/test/setup.ts`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/icon.svg`, `apps/web/app/api/[[...route]]/route.ts`
- Test: `apps/web/app/api/[[...route]]/route.test.ts`

**Interfaces:**
- Consumes: `createApiFromEnv(env)` from `@riff/api`, which returns `{ app, auth, close }`.
- Produces:
  - `GET`, `POST`, `PUT`, `PATCH` and `DELETE` route handlers for `/api/*`.
  - The `@/*` import alias for the app root, in both `tsconfig.json` and Vitest.
  - Theme tokens that every later component uses:
    - colours: `bg`, `surface`, `raised`, `line`, `fg`, `muted`, `faint`, `accent`, `accent-strong`, `on-accent`, `danger`
    - animations: `animate-eq`, `animate-pop-in`, `animate-sheet-in`
    - layout variables: `--player-h`, `--tabbar-h`, `--mini-h`, `--safe-b`
  - The jsdom polyfills that Radix components need, in `test/setup.ts`.

- [ ] **Step 1: Pin the web dependencies**

Replace the `catalog:` block of `pnpm-workspace.yaml` so it reads (the `allowBuilds` block below it is unchanged):

```yaml
catalog:
  '@dnd-kit/core': 6.3.1
  '@dnd-kit/modifiers': 9.0.0
  '@dnd-kit/sortable': 10.0.0
  '@dnd-kit/utilities': 3.2.2
  '@hono/zod-validator': 0.9.1
  '@playwright/test': 1.63.0
  '@tailwindcss/postcss': 4.3.3
  '@tanstack/react-query': 5.104.0
  '@tanstack/react-virtual': 3.14.13
  '@testing-library/dom': 10.4.2
  '@testing-library/jest-dom': 7.0.1
  '@testing-library/react': 16.3.3
  '@testing-library/user-event': 14.6.7
  '@types/node': 24.19.0
  '@types/react': 19.3.0
  '@types/react-dom': 19.3.0
  better-auth: 1.7.6
  clsx: 2.1.1
  drizzle-kit: 0.31.11
  drizzle-orm: 0.45.3
  fractional-indexing: 4.0.0
  geist: 1.7.2
  hono: 4.13.9
  jsdom: 30.1.1
  lucide-react: 1.48.0
  next: 16.3.6
  postgres: 3.4.9
  radix-ui: 1.6.7
  react: 19.3.0
  react-dom: 19.3.0
  sonner: 2.0.8
  tailwind-merge: 3.7.0
  tailwindcss: 4.3.3
  typescript: 7.0.2
  vitest: 5.0.2
  zod: 4.6.5
  zustand: 5.0.15
```

Create the package (Task 14 adds its `test:e2e` script):

```json
{
  "name": "@riff/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "next typegen && tsc --noEmit"
  },
  "dependencies": {
    "@dnd-kit/core": "catalog:",
    "@dnd-kit/modifiers": "catalog:",
    "@dnd-kit/sortable": "catalog:",
    "@dnd-kit/utilities": "catalog:",
    "@riff/api": "workspace:*",
    "@riff/core": "workspace:*",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-virtual": "catalog:",
    "better-auth": "catalog:",
    "clsx": "catalog:",
    "geist": "catalog:",
    "lucide-react": "catalog:",
    "next": "catalog:",
    "radix-ui": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "sonner": "catalog:",
    "tailwind-merge": "catalog:",
    "zod": "catalog:",
    "zustand": "catalog:"
  },
  "devDependencies": {
    "@playwright/test": "catalog:",
    "@tailwindcss/postcss": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "jsdom": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Save it as `apps/web/package.json`, then run `pnpm install`. Expected: `Done`, with no `ERR_PNPM_IGNORED_BUILDS` (sharp and Tailwind's oxide ship prebuilt binaries).

- [ ] **Step 2: Add the TypeScript, Next.js, PostCSS and Vitest config**

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["node"],
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:

```ts
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Local env vars live in the repo-root .env (Next reads only apps/web/.env* by itself).
// Variables already set in the environment win. Vercel sets them from the dashboard.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ['@riff/api', '@riff/catalog', '@riff/core', '@riff/db'],
};

export default nextConfig;
```

`apps/web/postcss.config.mjs`:

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

`apps/web/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});
```

`apps/web/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom lacks these browser APIs; Radix (sliders, menus) and the lyrics panel call them.
// Files that opt into the node environment have no DOM at all.
if (typeof Element !== 'undefined') {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= () => {};
}

// findBy*/waitFor default to 1 s, which parallel runs on a busy machine can exceed.
configure({ asyncUtilTimeout: 3_000 });

afterEach(() => cleanup());
```

`next dev` writes these two files. They are committed so the working tree stays clean:

`apps/web/AGENTS.md`:

```markdown
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
```

`apps/web/CLAUDE.md`:

```markdown
@AGENTS.md
```

`next-env.d.ts` is regenerated by `next dev`, `next build` and `next typegen`, so ignore it. Append to `.gitignore`:

```
next-env.d.ts
```

Biome needs Tailwind's CSS directives (`@theme`). In `biome.json`, add after the `javascript` line:

```json
  "css": { "parser": { "tailwindDirectives": true } },
```

Turbo's strict env mode hides undeclared variables from tasks. Replace `turbo.json`:

`turbo.json`:

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"],
      "env": [
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_URL",
        "ALLOW_SIGNUPS",
        "AUDIUS_API_URL",
        "AUDIUS_APP_NAME",
        "JAMENDO_CLIENT_ID",
        "RADIO_BROWSER_SERVERS",
        "VERCEL_URL",
        "VERCEL_BRANCH_URL"
      ]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "env": [
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_URL",
        "ALLOW_SIGNUPS",
        "AUDIUS_API_URL",
        "AUDIUS_APP_NAME",
        "JAMENDO_CLIENT_ID",
        "RADIO_BROWSER_SERVERS"
      ]
    },
    "transit": { "dependsOn": ["^transit"] },
    "test": { "dependsOn": ["^test"], "outputs": [], "env": ["DATABASE_URL_TEST"] },
    "typecheck": { "dependsOn": ["transit"], "outputs": [] }
  }
}
```

- [ ] **Step 3: Write the failing route test**

`apps/web/app/api/[[...route]]/route.test.ts`:

```ts
// @vitest-environment node
import { beforeAll, expect, test, vi } from 'vitest';

let GET: (request: Request) => Response | Promise<Response>;

beforeAll(async () => {
  // Valid config; nothing below needs a database connection.
  vi.stubEnv('DATABASE_URL', 'postgres://riff:riff@localhost:5432/riff_test');
  vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(32));
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  // The first import loads the whole API (Better Auth, Drizzle); give it room on a busy machine.
  ({ GET } = await import('./route'));
}, 30_000);

test('mounts the API at /api', async () => {
  const response = await GET(new Request('http://localhost:3000/api/health'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test('library routes still require a session', async () => {
  const response = await GET(new Request('http://localhost:3000/api/me'));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @riff/web exec vitest run app/api`
Expected: FAIL, with `Failed to resolve import "./route"`.

- [ ] **Step 5: Mount the API, and add the root layout and tokens**

`apps/web/app/api/[[...route]]/route.ts`:

```ts
import { createApiFromEnv } from '@riff/api';

// Built on the first request rather than at import, so `next build` needs no runtime env vars.
// One instance per server process: one DB pool (max 5) and one catalog cache.
// This is what `hono/vercel`'s `handle(app)` does, plus the lazy construction.
let api: ReturnType<typeof createApiFromEnv> | undefined;

function handler(request: Request): Response | Promise<Response> {
  api ??= createApiFromEnv(process.env);
  return api.app.fetch(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
```

`apps/web/app/globals.css`:

```css
/* biome-ignore-all lint/complexity/noImportantStyles: the reduced-motion override must beat utility classes */
@import "tailwindcss";

/*
 * Riff's palette: warm near-black surfaces and one ember accent.
 * Text tokens keep at least 4.5:1 contrast on every surface token.
 * Shapes: interactive controls are pills (rounded-full); panels, menus and cards use
 * rounded-xl/2xl; artwork uses rounded-md (rounded-full for artists).
 */
@theme {
  --color-bg: oklch(0.155 0.006 65);
  --color-surface: oklch(0.19 0.007 65);
  --color-raised: oklch(0.235 0.008 65);
  --color-line: oklch(0.3 0.008 65);
  --color-fg: oklch(0.96 0.005 80);
  --color-muted: oklch(0.74 0.01 70);
  --color-faint: oklch(0.62 0.01 70);
  --color-accent: oklch(0.76 0.15 52);
  --color-accent-strong: oklch(0.82 0.13 60);
  --color-on-accent: oklch(0.2 0.03 50);
  --color-danger: oklch(0.7 0.18 25);

  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  --animate-eq: eq 0.9s ease-in-out infinite alternate;
  --animate-pop-in: pop-in 120ms ease-out;
  --animate-sheet-in: sheet-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
  @keyframes eq {
    from {
      transform: scaleY(0.25);
    }
    to {
      transform: scaleY(1);
    }
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(6%);
    }
  }
}

@layer base {
  :root {
    --player-h: 5.5rem;
    --tabbar-h: 3.75rem;
    --mini-h: 4.5rem;
    --safe-b: env(safe-area-inset-bottom, 0px);
  }

  html {
    color-scheme: dark;
    background: var(--color-bg);
    color: var(--color-fg);
    -webkit-tap-highlight-color: transparent;
  }

  body {
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }

  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
```

`apps/web/app/layout.tsx`:

```tsx
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Riff', template: '%s · Riff' },
  description: 'Free music from Audius, Jamendo and live radio.',
};

export const viewport: Viewport = {
  themeColor: '#16130f',
  colorScheme: 'dark',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/app/icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <title>Riff</title>
  <rect width="32" height="32" rx="8" fill="#16130f" />
  <g fill="#f4944f">
    <rect x="8" y="14" width="4" height="10" rx="2" />
    <rect x="14" y="8" width="4" height="16" rx="2" />
    <rect x="20" y="11" width="4" height="13" rx="2" />
  </g>
</svg>
```

- [ ] **Step 6: Run the test, the typecheck, the build and the linter**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck && pnpm build && pnpm lint`
Expected:
- `Tests  2 passed (2)`
- `next typegen` prints `Types generated successfully`, and `tsc` reports nothing
- the build lists `ƒ /api/[[...route]]`
- Biome reports no errors

Then check the mount and env loading by hand:
1. Start `pnpm dev`.
2. `curl -s localhost:3000/api/health` returns `{"ok":true}`.
3. `curl -s localhost:3000/api/me` returns the 401 error body. This shows the root `.env` reached the API, with no env vars in the shell.
4. Stop the server.

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm lint
git add .gitignore biome.json turbo.json pnpm-workspace.yaml pnpm-lock.yaml apps/web
git commit -m "feat(web): scaffold Next.js app with Tailwind tokens and the API mounted at /api"
```

### Task 3: API wrapper, sign-in and sign-up, and the session proxy

**Files:**
- Create: `apps/web/lib/api.ts`, `apps/web/lib/redirect.ts`, `apps/web/lib/auth-client.ts`, `apps/web/lib/cn.ts`, `apps/web/components/ui/button.tsx`, `apps/web/components/ui/input.tsx`, `apps/web/components/brand/logo.tsx`, `apps/web/components/auth/auth-form.tsx`, `apps/web/app/(auth)/layout.tsx`, `apps/web/app/(auth)/sign-in/page.tsx`, `apps/web/app/(auth)/sign-up/page.tsx`, `apps/web/proxy.ts`
- Test: `apps/web/lib/api.test.ts`, `apps/web/lib/redirect.test.ts`, `apps/web/components/auth/auth-form.test.tsx`, `apps/web/proxy.test.ts`

**Interfaces:**
- Consumes:
  - `createApiClient(baseUrl)` from `@riff/api/client`, and the type `ErrorCode` from `@riff/api`.
  - `createAuthClient` from `better-auth/react`, and `getSessionCookie` from `better-auth/cookies`.
- Produces:
  - `lib/api.ts`:
    - `api`: the typed client on `/api`.
    - `unwrap<T>(pending: Promise<{ ok; status; json(): Promise<T> }>): Promise<T>`, and `expectOk(pending): Promise<void>` for 204 routes. Both throw `ApiRequestError { status: number; code: ErrorCode; message }`. On a 401, they first call the unauthorized handler, which defaults to redirecting to `/sign-in?next=<current path>`.
    - `setUnauthorizedHandler(handler | null)`, for tests.
  - `lib/redirect.ts`: `safeNextPath(next: string | null | undefined): string` (same-origin paths only; the auth pages fall back to `/`), and `signInPath(next: string): string`.
  - `lib/auth-client.ts`: `authClient`.
  - `lib/cn.ts`: `cn(...classes)`.
  - `components/ui/button.tsx`: `<Button variant="primary|secondary|ghost|outline" size="sm|md|lg|icon|icon-sm" asChild?>`.
  - `components/ui/input.tsx`: `<Input>` and `<Label>`.
  - `components/brand/logo.tsx`: `<Logo className labelClassName>`.
  - `components/auth/auth-form.tsx`: `<AuthForm mode="sign-in|sign-up" next>`, and `authErrorMessage(error)`.
  - `proxy.ts`: `proxy(request)` and `config.matcher`.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, api, expectOk, setUnauthorizedHandler, unwrap } from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(response: Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('unwrap', () => {
  test('returns the JSON body of a successful response', async () => {
    const fetch = stubFetch(json(['audius:a']));
    await expect(unwrap(api.me.likes.ids.$get())).resolves.toEqual(['audius:a']);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/me/likes/ids');
  });

  test('sends query values and omits undefined ones', async () => {
    const fetch = stubFetch(json({ tracks: [], sources: {} }));
    await unwrap(api.trending.$get({ query: { genre: undefined, window: 'month', limit: '5' } }));
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/trending?window=month&limit=5');
  });

  test('throws ApiRequestError with the error contract fields', async () => {
    stubFetch(json({ error: { code: 'UPSTREAM_ERROR', message: 'Audius is down' } }, 502));
    const error = await unwrap(api.tracks[':id'].$get({ param: { id: 'audius:x' } })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 502, code: 'UPSTREAM_ERROR', message: 'Audius is down' });
  });

  test('falls back to a generic error when the body is not the contract', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(unwrap(api.home.$get())).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL',
      message: 'Request failed (502)',
    });
  });

  test('calls the unauthorized handler on 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(json({ error: { code: 'UNAUTHORIZED', message: 'Sign in to continue' } }, 401));
    await expect(unwrap(api.home.$get())).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('expectOk', () => {
  test('resolves for 204 responses', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(
      expectOk(api.me.likes[':trackId'].$put({ param: { trackId: 'audius:a' } })),
    ).resolves.toBeUndefined();
  });

  test('throws for errors', async () => {
    stubFetch(json({ error: { code: 'NOT_FOUND', message: 'No such track' } }, 404));
    await expect(
      expectOk(api.me.likes[':trackId'].$put({ param: { trackId: 'audius:a' } })),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
```

`apps/web/lib/redirect.test.ts`:

```ts
import { expect, test } from 'vitest';
import { safeNextPath, signInPath } from './redirect';

test.each([
  ['/liked', '/liked'],
  ['/search?q=lofi%20beats', '/search?q=lofi%20beats'],
  ['/playlist/1#top', '/playlist/1#top'],
])('keeps the in-app path %s', (next, expected) => {
  expect(safeNextPath(next)).toBe(expected);
});

test.each([
  [null],
  [''],
  ['liked'],
  ['//evil.example'],
  ['/\\evil.example'],
  ['/\t/evil.example'],
  ['https://evil.example/liked'],
  ['javascript:alert(1)'],
  ['/sign-in?next=/liked'],
  ['/sign-up'],
])('falls back to / for %j', (next) => {
  expect(safeNextPath(next)).toBe('/');
});

test('signInPath encodes the path to return to', () => {
  expect(signInPath('/search?q=a&b')).toBe('/sign-in?next=%2Fsearch%3Fq%3Da%26b');
});
```

`apps/web/proxy.test.ts`:

```ts
// @vitest-environment node
import { getRedirectUrl, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, test } from 'vitest';
import { config, proxy } from './proxy';

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });

describe('proxy', () => {
  test('sends visitors without a session cookie to /sign-in, remembering the page', () => {
    const response = proxy(request('/search?q=lofi'));
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(
      'http://localhost:3000/sign-in?next=%2Fsearch%3Fq%3Dlofi',
    );
  });

  test('lets requests with a session cookie through (the API still checks it)', () => {
    for (const cookie of [
      'better-auth.session_token=abc.def',
      '__Secure-better-auth.session_token=abc.def',
    ]) {
      expect(getRedirectUrl(proxy(request('/liked', cookie)))).toBeNull();
    }
  });

  test.each(['/', '/liked', '/playlist/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', '/search'])(
    'guards %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );

  test.each(['/sign-in', '/sign-up', '/api/me', '/api/auth/get-session', '/_next/static/x.js'])(
    'skips %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});
```

`apps/web/components/auth/auth-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AuthForm } from './auth-form';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: auth.signIn }, signUp: { email: auth.signUp } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthForm', () => {
  test('signs in and goes to the page the user came from', async () => {
    auth.signIn.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="sign-in" next="/liked" />);
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.signIn).toHaveBeenCalledWith({ email: 'me@example.com', password: 'longenough1' });
    expect(router.replace).toHaveBeenCalledWith('/liked');
  });

  test('signs up with a name', async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="sign-up" next="/" />);
    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(auth.signUp).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'longenough1',
    });
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  test.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'Wrong email or password.'],
    ['EMAIL_PASSWORD_SIGN_UP_DISABLED', 'Sign-ups are closed on this server.'],
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'An account with this email already exists.'],
  ])('explains %s and stays on the page', async (code, message) => {
    auth.signIn.mockResolvedValue({ data: null, error: { code, message: 'raw', status: 400 } });
    render(<AuthForm mode="sign-in" next="/" />);
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(router.replace).not.toHaveBeenCalled();
  });

  test('reports a network failure instead of hanging', async () => {
    auth.signIn.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<AuthForm mode="sign-in" next="/" />);
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('links to the other form, keeping the destination', () => {
    render(<AuthForm mode="sign-in" next="/liked" />);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/sign-up?next=%2Fliked',
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run lib proxy.test.ts components/auth`
Expected: all four files FAIL with `Failed to resolve import` (`./api`, `./redirect`, `./proxy`, `./auth-form`).

- [ ] **Step 3: Write the API wrapper and redirect helpers**

`apps/web/lib/redirect.ts`:

```ts
const PROBE_ORIGIN = 'http://riff.invalid';

/**
 * Where to go after signing in. Only same-origin paths are allowed, so `?next=` can never send
 * the user to another site; the auth pages themselves fall back to Home.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next?.startsWith('/')) return '/';
  // The URL parser applies the browser's rules: it drops tabs and newlines and reads `\` as `/`.
  const url = new URL(next, PROBE_ORIGIN);
  if (url.origin !== PROBE_ORIGIN) return '/';
  if (url.pathname === '/sign-in' || url.pathname === '/sign-up') return '/';
  return url.pathname + url.search + url.hash;
}

export const signInPath = (next: string): string => `/sign-in?next=${encodeURIComponent(next)}`;
```

`apps/web/lib/api.ts`:

```ts
import type { ErrorCode } from '@riff/api';
import { createApiClient } from '@riff/api/client';
import { signInPath } from './redirect';

/** The typed API client. Paths are relative to /api; query values are strings. */
export const api = createApiClient('/api');

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

const redirectToSignIn = () => {
  window.location.assign(signInPath(window.location.pathname + window.location.search));
};

let onUnauthorized: () => void = redirectToSignIn;

/** Replaces what happens on a 401 (tests); `null` restores the redirect to /sign-in. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler ?? redirectToSignIn;
}

/** Resolves a typed-client call to its JSON body, or throws ApiRequestError. */
export async function unwrap<T>(pending: Promise<ApiResponse<T>>): Promise<T> {
  const response = await pending;
  if (!response.ok) throw await failure(response);
  return response.json();
}

/** For routes that answer 204: resolves when the call succeeded, or throws ApiRequestError. */
export async function expectOk(pending: Promise<ApiResponse<unknown>>): Promise<void> {
  const response = await pending;
  if (!response.ok) throw await failure(response);
}

async function failure(response: ApiResponse<unknown>): Promise<ApiRequestError> {
  if (response.status === 401) onUnauthorized();
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: ErrorCode; message?: string };
  } | null;
  return new ApiRequestError(
    response.status,
    body?.error?.code ?? 'INTERNAL',
    body?.error?.message ?? `Request failed (${response.status})`,
  );
}
```

`apps/web/lib/auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/react';

/** Better Auth's browser client; the server half is mounted at /api/auth by @riff/api. */
export const authClient = createAuthClient({ basePath: '/api/auth' });
```

`apps/web/lib/cn.ts`:

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names; later Tailwind utilities override earlier conflicting ones. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
```

- [ ] **Step 4: Write the proxy**

It checks only that a session cookie exists; the API validates it. Next 16 runs `proxy.ts` on the Node runtime.

`apps/web/proxy.ts`:

```ts
import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Sends visitors without a session cookie to /sign-in. This only checks that a cookie exists;
 * the API validates it. A stale cookie gets through here and the first API call's 401 sends the
 * user to /sign-in, which this proxy never redirects away from, so there is no loop.
 */
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|sign-in|sign-up|favicon.ico|icon|apple-icon|manifest).*)'],
};
```

- [ ] **Step 5: Write the first UI primitives, the logo and the auth pages**

`apps/web/components/ui/button.tsx`:

```tsx
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const VARIANTS = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong',
  secondary: 'bg-raised text-fg hover:bg-line',
  ghost: 'text-muted hover:bg-raised hover:text-fg',
  outline: 'border border-line text-fg hover:border-muted',
} as const;

const SIZES = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
  icon: 'size-10',
  'icon-sm': 'size-8',
} as const;

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
}

/** Interactive controls are pills; see the shape rule in globals.css. */
export function Button({
  variant = 'secondary',
  size = 'md',
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-medium transition-[color,background-color,border-color,transform] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[1.15em] [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
```

`apps/web/components/ui/input.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-full border border-line bg-surface px-4 text-sm text-fg outline-none transition-colors placeholder:text-faint hover:border-faint focus-visible:border-accent focus-visible:outline-none aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor
  return <label className={cn('font-medium text-muted text-sm', className)} {...props} />;
}
```

`apps/web/components/brand/logo.tsx`:

```tsx
import { cn } from '@/lib/cn';

/** Wordmark: three equalizer bars and the name. `labelClassName` can hide the name. */
export function Logo({
  className,
  labelClassName,
}: {
  className?: string;
  labelClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span aria-hidden className="flex h-[0.9em] items-end gap-[0.12em]">
        <span className="h-[55%] w-[0.18em] rounded-full bg-accent" />
        <span className="h-full w-[0.18em] rounded-full bg-accent" />
        <span className="h-[75%] w-[0.18em] rounded-full bg-accent" />
      </span>
      <span className={labelClassName}>Riff</span>
    </span>
  );
}
```

Better Auth's error codes, checked against the running API: `INVALID_EMAIL_OR_PASSWORD`, `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, `PASSWORD_TOO_SHORT` (under 8 characters), `EMAIL_PASSWORD_SIGN_UP_DISABLED` and `VALIDATION_ERROR`.

`apps/web/components/auth/auth-form.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

type Mode = 'sign-in' | 'sign-up';

interface AuthError {
  code?: string;
  message?: string;
  status?: number;
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'Sign-ups are closed on this server.',
  USER_ALREADY_EXISTS: 'An account with this email already exists.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long.',
};

export function authErrorMessage(error: AuthError): string {
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code] as string;
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return error.message || 'Something went wrong. Try again.';
}

const COPY = {
  'sign-in': {
    title: 'Sign in',
    submit: 'Sign in',
    switchText: 'New here?',
    switchLink: 'Create an account',
    switchHref: '/sign-up',
  },
  'sign-up': {
    title: 'Create your account',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
    switchHref: '/sign-in',
  },
} as const;

export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));
    setPending(true);
    setError(null);
    try {
      const result =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ name: String(form.get('name')), email, password });
      if (result.error) {
        setError(authErrorMessage(result.error));
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-5">
      <h1 className="font-semibold text-2xl tracking-tight">{copy.title}</h1>
      {mode === 'sign-up' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required maxLength={100} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'sign-up' ? 8 : undefined}
        />
        {mode === 'sign-up' && <p className="text-faint text-xs">At least 8 characters.</p>}
      </div>
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {copy.submit}
      </Button>
      <p className="text-muted text-sm">
        {copy.switchText}{' '}
        <Link
          href={`${copy.switchHref}?next=${encodeURIComponent(next)}`}
          className="font-medium text-fg underline-offset-4 hover:underline"
        >
          {copy.switchLink}
        </Link>
      </p>
    </form>
  );
}
```

`apps/web/app/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <section className="relative hidden overflow-hidden bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute -bottom-40 -left-40 size-[36rem] rounded-full bg-accent/15 blur-3xl"
        />
        <Logo className="relative text-2xl" />
        <p className="relative max-w-md font-semibold text-4xl leading-tight tracking-tight">
          Independent music and live radio, free and ad-free.
        </p>
      </section>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-10">
          <Logo className="text-xl lg:hidden" />
          {children}
        </div>
      </section>
    </main>
  );
}
```

`apps/web/app/(auth)/sign-in/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { safeNextPath } from '@/lib/redirect';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-in" next={safeNextPath(typeof next === 'string' ? next : null)} />;
}
```

`apps/web/app/(auth)/sign-up/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { safeNextPath } from '@/lib/redirect';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-up" next={safeNextPath(typeof next === 'string' ? next : null)} />;
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck`
Expected: `Tests  41 passed (41)`: route 2, api 7, redirect 14, proxy 11, auth form 7. No type errors.

Check the flow by hand with `pnpm dev`:
1. Opening `http://localhost:3000/liked` redirects to `/sign-in?next=%2Fliked`.
2. Creating an account there lands on `/liked`. It 404s until Task 11, and that's expected.

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add the typed API wrapper, sign-in and sign-up, and the session proxy"
```

### Task 4: The audio engine

A plain class over one media element, written against an interface so tests can drive a fake one. It knows nothing about queues.

**Files:**
- Create: `apps/web/lib/player/engine.ts`, `apps/web/test/fixtures.ts`, `apps/web/test/fake-media.ts`
- Test: `apps/web/lib/player/engine.test.ts`

**Interfaces:**
- Consumes: `StreamInfo` and `Track` from `@riff/core`.
- Produces:
  - `MediaElementLike`: the subset of `HTMLAudioElement` the engine uses.
  - `EngineEvents`:
    - `onStatus(status: 'loading' | 'playing' | 'paused')`
    - `onTime(positionSec: number)`
    - `onDuration(durationSec: number | null)`
    - `onEnded()`
    - `onFailed(track, error)`
  - `ResolveStream = (trackId) => Promise<StreamInfo>`
  - `class AudioEngine(media, resolve, events)`:
    - `loadedTrackId: string | null`
    - `load(track, { autoplay, startAt? }): Promise<void>`
    - `play()`, `pause()`, `seek(sec)`, `setVolume(gain)`, `setMuted(muted)`
    - `prefetch(track)`, `unload()`, `destroy()`
  - Constants: `PREFETCH_TTL_MS` (5 min) and `STALL_TIMEOUT_MS` (15 s).
  - Test helpers:
    - `test/fixtures.ts`: `track(n, overrides?)` (id `audius:t<n>`, title `Track <n>`, artist `audius:a<n>` / `Artist <n>`, 180 s, artwork `https://img.test/<n>-150.jpg` and `-480.jpg`), `tracks(count)`, and `station(n)` (a live `radio:` track).
    - `test/fake-media.ts`: `FakeMedia`, which records `srcHistory` and fires events with `emit(type)`.

- [ ] **Step 1: Write the test helpers and the failing tests**

`apps/web/test/fixtures.ts`:

```ts
import type { Track } from '@riff/core';

/** A finite Audius-style track. `n` keeps ids and titles distinct. */
export function track(n: number, overrides: Partial<Track> = {}): Track {
  return {
    id: `audius:t${n}`,
    source: 'audius',
    title: `Track ${n}`,
    artists: [{ id: `audius:a${n}`, name: `Artist ${n}` }],
    durationSec: 180,
    isLive: false,
    artwork: { sm: `https://img.test/${n}-150.jpg`, md: `https://img.test/${n}-480.jpg` },
    genre: 'Electronic',
    ...overrides,
  };
}

export const tracks = (count: number): Track[] =>
  Array.from({ length: count }, (_, i) => track(i + 1));

/** A live radio station. */
export function station(n: number): Track {
  return {
    id: `radio:9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6${n}`,
    source: 'radio',
    title: `Station ${n}`,
    artists: [],
    durationSec: null,
    isLive: true,
    artwork: {},
  };
}
```

`apps/web/test/fake-media.ts`:

```ts
import type { MediaElementLike } from '@/lib/player/engine';

type Listener = () => void;

/**
 * A scriptable stand-in for HTMLAudioElement. Tests drive it with `emit()` and inspect the
 * sources it was given in `srcHistory`.
 */
export class FakeMedia implements MediaElementLike {
  currentTime = 0;
  duration = Number.NaN;
  volume = 1;
  muted = false;
  paused = true;
  ended = false;
  preload = '';
  srcHistory: string[] = [];
  /** What the next play() call does; defaults to starting playback. */
  playResult: () => Promise<void> = async () => {
    this.paused = false;
  };
  private readonly listeners = new Map<string, Set<Listener>>();

  private currentSrc = '';

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    this.srcHistory.push(value);
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.currentSrc = '';
  }

  load(): void {}

  play(): Promise<void> {
    return this.playResult();
  }

  pause(): void {
    this.paused = true;
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}
```

`apps/web/lib/player/engine.test.ts`:

```ts
import type { StreamInfo, Track } from '@riff/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeMedia } from '@/test/fake-media';
import { station, track } from '@/test/fixtures';
import { AudioEngine, type EngineEvents, STALL_TIMEOUT_MS } from './engine';

const info = (url: string, mirrors: string[] = []): StreamInfo => ({ url, mirrors, live: false });

let media: FakeMedia;
let resolve: ReturnType<typeof vi.fn<(id: string) => Promise<StreamInfo>>>;
let events: { [K in keyof EngineEvents]: ReturnType<typeof vi.fn<EngineEvents[K]>> };
let engine: AudioEngine;

beforeEach(() => {
  media = new FakeMedia();
  resolve = vi.fn(async (id: string) => info(`https://a.test/${id}`, [`https://b.test/${id}`]));
  events = {
    onStatus: vi.fn(),
    onTime: vi.fn(),
    onDuration: vi.fn(),
    onEnded: vi.fn(),
    onFailed: vi.fn(),
  };
  engine = new AudioEngine(media, resolve, events);
});

/** Lets pending promise callbacks (resolve, play) run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

async function playing(t: Track, startAt = 0) {
  await engine.load(t, { autoplay: true, startAt });
  media.emit('loadedmetadata');
  media.emit('playing');
}

describe('load', () => {
  test('resolves the stream, sets the source and plays', async () => {
    await engine.load(track(1), { autoplay: true });
    expect(resolve).toHaveBeenCalledWith('audius:t1');
    expect(media.src).toBe('https://a.test/audius:t1');
    expect(media.paused).toBe(false);
    expect(events.onStatus).toHaveBeenCalledWith('loading');
    media.emit('playing');
    expect(events.onStatus).toHaveBeenLastCalledWith('playing');
    expect(engine.loadedTrackId).toBe('audius:t1');
  });

  test('without autoplay, loads paused and seeks to the start position once metadata is in', async () => {
    await engine.load(track(1), { autoplay: false, startAt: 42 });
    expect(media.paused).toBe(true);
    media.emit('loadedmetadata');
    expect(media.currentTime).toBe(42);
  });

  test('reports a failed resolution without touching the element', async () => {
    resolve.mockRejectedValueOnce(new Error('502'));
    await engine.load(track(1), { autoplay: true });
    expect(events.onFailed).toHaveBeenCalledOnce();
    expect(media.srcHistory).toEqual([]);
  });

  test('ignores a resolution that finishes after another track was loaded', async () => {
    let release: (value: StreamInfo) => void = () => {};
    resolve.mockImplementationOnce(() => new Promise((done) => (release = done)));
    const first = engine.load(track(1), { autoplay: true });
    await engine.load(track(2), { autoplay: true });
    release(info('https://a.test/stale'));
    await first;
    expect(media.src).toBe('https://a.test/audius:t2');
    expect(engine.loadedTrackId).toBe('audius:t2');
  });

  test('a blocked autoplay leaves the player paused', async () => {
    media.playResult = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    await engine.load(track(1), { autoplay: true });
    await settle();
    expect(events.onStatus).toHaveBeenLastCalledWith('paused');
  });
});

describe('failover', () => {
  test('tries the next mirror at the same position', async () => {
    await playing(track(1));
    media.currentTime = 61;
    media.emit('timeupdate');
    media.currentTime = 0;
    media.emit('error');
    expect(media.src).toBe('https://b.test/audius:t1');
    media.emit('loadedmetadata');
    expect(media.currentTime).toBe(61);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test('when every mirror fails, resolves again once and resumes where it was', async () => {
    resolve
      .mockResolvedValueOnce(info('https://a.test/old', ['https://b.test/old']))
      .mockResolvedValueOnce(info('https://a.test/fresh'));
    await playing(track(1));
    media.currentTime = 90;
    media.emit('timeupdate');
    media.emit('error');
    media.emit('error');
    await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(media.src).toBe('https://a.test/fresh');
    media.emit('loadedmetadata');
    expect(media.currentTime).toBe(90);
    expect(media.paused).toBe(false);
    expect(events.onFailed).not.toHaveBeenCalled();
  });

  test('gives up after the fresh resolution fails too', async () => {
    await playing(track(1));
    for (let i = 0; i < 4; i++) {
      media.emit('error');
      await settle();
    }
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(events.onFailed).toHaveBeenCalledOnce();
    expect(events.onFailed.mock.calls[0]?.[0]).toMatchObject({ id: 'audius:t1' });
  });

  test('recovers from a second expiry later in the same track', async () => {
    await playing(track(1));
    // First expiry: both mirrors fail, a fresh resolution plays.
    media.emit('error');
    media.emit('error');
    await settle();
    media.emit('playing');
    // Much later, the fresh URL expires as well.
    media.emit('error');
    media.emit('error');
    await settle();
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(events.onFailed).not.toHaveBeenCalled();
  });

  test('a source that never starts playing counts as failed', async () => {
    vi.useFakeTimers();
    try {
      await engine.load(track(1), { autoplay: true });
      expect(media.src).toBe('https://a.test/audius:t1');
      vi.advanceTimersByTime(STALL_TIMEOUT_MS);
      expect(media.src).toBe('https://b.test/audius:t1');
      // Audio arriving in time cancels the watchdog.
      media.emit('playing');
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);
      expect(media.src).toBe('https://b.test/audius:t1');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a stall mid-track (waiting with no progress) fails over too', async () => {
    vi.useFakeTimers();
    try {
      await playing(track(1));
      media.currentTime = 40;
      media.emit('timeupdate');
      media.emit('waiting');
      vi.advanceTimersByTime(STALL_TIMEOUT_MS);
      expect(media.src).toBe('https://b.test/audius:t1');
      media.emit('loadedmetadata');
      expect(media.currentTime).toBe(40);
    } finally {
      vi.useRealTimers();
    }
  });

  test('pausing while loading does not count as a stall', async () => {
    vi.useFakeTimers();
    try {
      await engine.load(track(1), { autoplay: true });
      engine.pause();
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);
      expect(media.srcHistory).toEqual(['https://a.test/audius:t1']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('ignores errors when nothing is loaded', () => {
    media.emit('error');
    expect(events.onFailed).not.toHaveBeenCalled();
  });
});

describe('prefetch', () => {
  test('the next load uses the prefetched stream instead of resolving again', async () => {
    await engine.prefetch(track(2));
    expect(resolve).toHaveBeenCalledTimes(1);
    await engine.load(track(2), { autoplay: true });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(media.src).toBe('https://a.test/audius:t2');
  });

  test('a prefetched stream is used once', async () => {
    await engine.prefetch(track(2));
    await engine.load(track(2), { autoplay: true });
    await engine.load(track(2), { autoplay: true });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  test('stale prefetches are dropped', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    await engine.prefetch(track(2));
    now.mockReturnValue(10 * 60_000);
    await engine.load(track(2), { autoplay: true });
    expect(resolve).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  test('a failed prefetch is silent', async () => {
    resolve.mockRejectedValueOnce(new Error('offline'));
    await expect(engine.prefetch(track(2))).resolves.toBeUndefined();
    expect(events.onFailed).not.toHaveBeenCalled();
  });

  test('live stations are never prefetched (resolution counts as a listen)', async () => {
    await engine.prefetch(station(1));
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('controls and element events', () => {
  test('seek moves the element and is ignored for live stations', async () => {
    await playing(track(1));
    engine.seek(30);
    expect(media.currentTime).toBe(30);
    await playing(station(1));
    media.currentTime = 5;
    engine.seek(100);
    expect(media.currentTime).toBe(5);
  });

  test('live streams never restore a position', async () => {
    await playing(station(1), 300);
    expect(media.currentTime).toBe(0);
  });

  test('reports time, duration (null for live), waiting, pause and end', async () => {
    await playing(track(1));
    media.currentTime = 12.5;
    media.emit('timeupdate');
    expect(events.onTime).toHaveBeenLastCalledWith(12.5);
    media.duration = 180;
    media.emit('durationchange');
    expect(events.onDuration).toHaveBeenLastCalledWith(180);
    media.duration = Number.POSITIVE_INFINITY;
    media.emit('durationchange');
    expect(events.onDuration).toHaveBeenLastCalledWith(null);
    media.emit('waiting');
    expect(events.onStatus).toHaveBeenLastCalledWith('loading');
    media.paused = true;
    media.emit('pause');
    expect(events.onStatus).toHaveBeenLastCalledWith('paused');
    media.ended = true;
    media.emit('pause');
    media.emit('ended');
    expect(events.onStatus).toHaveBeenLastCalledWith('paused');
    expect(events.onEnded).toHaveBeenCalledOnce();
  });

  test('play, pause, volume and mute drive the element', async () => {
    await engine.load(track(1), { autoplay: false });
    await engine.play();
    expect(media.paused).toBe(false);
    engine.pause();
    expect(media.paused).toBe(true);
    engine.setVolume(0.25);
    engine.setMuted(true);
    expect(media.volume).toBe(0.25);
    expect(media.muted).toBe(true);
  });

  test('unload clears the source; destroy removes every listener', async () => {
    await playing(track(1));
    engine.unload();
    expect(media.src).toBe('');
    expect(engine.loadedTrackId).toBeNull();
    engine.destroy();
    expect(media.listenerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run lib/player/engine`
Expected: FAIL, with `Failed to resolve import "./engine"`.

- [ ] **Step 3: Write the engine**

The failover order and why:
1. **Mirrors.** On a media `error`, the next mirror is tried at the saved position.
2. **One fresh resolution.** Mirrors share one signature, so an expired URL fails on all of them. The engine then resolves once more and resumes where it was.
3. **Give up.** If that also fails, it calls `onFailed`.

A `playing` event re-arms the fresh resolution for later expiries. The watchdog covers the case browsers never report: a source that connects and then sends nothing.

`apps/web/lib/player/engine.ts`:

```ts
import type { StreamInfo, Track } from '@riff/core';

/** The parts of HTMLAudioElement the engine uses (a fake stands in for it in tests). */
export interface MediaElementLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  volume: number;
  muted: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type EngineStatus = 'loading' | 'playing' | 'paused';

export interface EngineEvents {
  onStatus(status: EngineStatus): void;
  onTime(positionSec: number): void;
  /** null for live streams (and before metadata). */
  onDuration(durationSec: number | null): void;
  onEnded(): void;
  /** Every mirror failed, and so did one fresh resolution. */
  onFailed(track: Track, error: unknown): void;
}

export type ResolveStream = (trackId: string) => Promise<StreamInfo>;

/** Signed URLs outlive this comfortably; older prefetches are resolved again. */
export const PREFETCH_TTL_MS = 5 * 60_000;

/**
 * A source that accepts the connection but sends no audio for this long is treated as failed
 * (browsers report no error for a stalled mirror; they just wait).
 */
export const STALL_TIMEOUT_MS = 15_000;

interface LoadOptions {
  autoplay: boolean;
  /** Where to start, in seconds (ignored for live streams). */
  startAt?: number;
}

/**
 * Owns one media element: resolves streams, fails over across mirrors, re-resolves once when
 * every mirror fails (expired signatures), and prefetches the next track's stream. It knows
 * nothing about queues; the player store decides what to load.
 */
export class AudioEngine {
  private track: Track | null = null;
  private sources: string[] = [];
  private sourceIndex = 0;
  private reResolved = false;
  /** Increments per load, so a slow resolution for an old track is ignored. */
  private generation = 0;
  /** Position to restore after the next `loadedmetadata`. */
  private resumeAt = 0;
  /** Last position reported by the element; survives the element resetting on error. */
  private position = 0;
  private wantsPlay = false;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly prefetched = new Map<string, { info: StreamInfo; at: number }>();
  private readonly listeners: [string, () => void][];

  constructor(
    private readonly media: MediaElementLike,
    private readonly resolve: ResolveStream,
    private readonly events: EngineEvents,
  ) {
    media.preload = 'auto';
    this.listeners = [
      ['loadedmetadata', this.handleMetadata],
      ['playing', this.handlePlaying],
      ['waiting', this.handleWaiting],
      ['pause', this.handlePause],
      ['timeupdate', this.handleTime],
      ['durationchange', this.handleDuration],
      ['ended', this.handleEnded],
      ['error', this.handleError],
    ];
    for (const [type, listener] of this.listeners) media.addEventListener(type, listener);
  }

  /** Id of the track whose audio is loaded (or loading), if any. */
  get loadedTrackId(): string | null {
    return this.track?.id ?? null;
  }

  async load(track: Track, { autoplay, startAt = 0 }: LoadOptions): Promise<void> {
    const generation = ++this.generation;
    this.track = track;
    this.reResolved = false;
    this.wantsPlay = autoplay;
    this.resumeAt = track.isLive ? 0 : startAt;
    this.position = this.resumeAt;
    this.events.onStatus('loading');
    let info: StreamInfo;
    try {
      info = this.takePrefetched(track.id) ?? (await this.resolve(track.id));
    } catch (error) {
      if (generation === this.generation) this.events.onFailed(track, error);
      return;
    }
    if (generation !== this.generation) return;
    this.useStream(info);
  }

  async play(): Promise<void> {
    this.wantsPlay = true;
    this.armWatchdog();
    await this.media.play().catch(this.handlePlayRejection);
  }

  pause(): void {
    this.wantsPlay = false;
    this.disarmWatchdog();
    this.media.pause();
  }

  seek(positionSec: number): void {
    if (!this.track || this.track.isLive) return;
    this.media.currentTime = positionSec;
    this.position = positionSec;
  }

  setVolume(gain: number): void {
    this.media.volume = gain;
  }

  setMuted(muted: boolean): void {
    this.media.muted = muted;
  }

  /** Resolves `track`'s stream ahead of time; the next `load` of it skips the round trip. */
  async prefetch(track: Track): Promise<void> {
    // Radio Browser counts a resolution as a listen, so stations resolve only on play.
    if (track.isLive || this.prefetched.has(track.id)) return;
    try {
      const info = await this.resolve(track.id);
      this.prefetched.clear();
      this.prefetched.set(track.id, { info, at: Date.now() });
    } catch {
      // Prefetching is an optimisation; the real load will resolve (and report) again.
    }
  }

  /** Stops playback and releases the network connection. */
  unload(): void {
    this.generation++;
    this.track = null;
    this.wantsPlay = false;
    this.disarmWatchdog();
    this.media.pause();
    this.media.removeAttribute('src');
    this.media.load();
  }

  destroy(): void {
    this.unload();
    for (const [type, listener] of this.listeners) this.media.removeEventListener(type, listener);
  }

  private takePrefetched(trackId: string): StreamInfo | null {
    const entry = this.prefetched.get(trackId);
    this.prefetched.delete(trackId);
    if (!entry || Date.now() - entry.at > PREFETCH_TTL_MS) return null;
    return entry.info;
  }

  private useStream(info: StreamInfo): void {
    this.sources = [info.url, ...info.mirrors];
    this.sourceIndex = 0;
    this.setSource();
  }

  private setSource(): void {
    this.media.src = this.sources[this.sourceIndex] as string;
    if (!this.wantsPlay) return;
    this.armWatchdog();
    void this.media.play().catch(this.handlePlayRejection);
  }

  /** Until audio flows, a silent source is treated like one that errored. */
  private armWatchdog(): void {
    this.disarmWatchdog();
    if (this.wantsPlay) this.stallTimer = setTimeout(this.handleError, STALL_TIMEOUT_MS);
  }

  private disarmWatchdog(): void {
    clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
  }

  private readonly handlePlayRejection = (error: unknown) => {
    // AbortError: the source changed before playback started; the new source plays instead.
    // NotSupportedError also arrives as an `error` event, which drives the failover.
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      this.wantsPlay = false;
      this.disarmWatchdog();
      this.events.onStatus('paused');
    }
  };

  private readonly handleMetadata = () => {
    if (this.resumeAt > 0) this.media.currentTime = this.resumeAt;
    this.resumeAt = 0;
  };

  private readonly handlePlaying = () => {
    this.disarmWatchdog();
    // Audio is flowing again, so a later expiry (e.g. on a seek) earns a fresh resolution.
    this.reResolved = false;
    this.events.onStatus('playing');
  };

  private readonly handleWaiting = () => {
    if (!this.wantsPlay) return;
    this.armWatchdog();
    this.events.onStatus('loading');
  };

  private readonly handlePause = () => {
    // The element also fires `pause` when a track ends; `ended` handles that case.
    if (this.media.ended) return;
    this.wantsPlay = false;
    this.disarmWatchdog();
    this.events.onStatus('paused');
  };

  private readonly handleTime = () => {
    this.position = this.media.currentTime;
    this.events.onTime(this.position);
  };

  private readonly handleDuration = () => {
    const { duration } = this.media;
    this.events.onDuration(Number.isFinite(duration) ? duration : null);
  };

  private readonly handleEnded = () => {
    this.events.onEnded();
  };

  private readonly handleError = () => {
    this.disarmWatchdog();
    const track = this.track;
    if (!track || this.sources.length === 0) return;
    this.resumeAt = track.isLive ? 0 : this.position;
    if (this.sourceIndex + 1 < this.sources.length) {
      this.sourceIndex++;
      this.setSource();
      return;
    }
    if (this.reResolved) {
      this.events.onFailed(track, new Error('Every stream source failed'));
      return;
    }
    this.reResolved = true;
    void this.reResolve(track);
  };

  private async reResolve(track: Track): Promise<void> {
    const generation = this.generation;
    const resumeAt = this.resumeAt;
    let info: StreamInfo;
    try {
      info = await this.resolve(track.id);
    } catch (error) {
      if (generation === this.generation) this.events.onFailed(track, error);
      return;
    }
    if (generation !== this.generation) return;
    this.resumeAt = resumeAt;
    this.useStream(info);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @riff/web exec vitest run lib/player/engine && pnpm --filter @riff/web typecheck`
Expected: `Tests  23 passed (23)`, and no type errors.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add the audio engine with mirror failover, re-resolve and prefetch"
```

### Task 5: The player store

**Files:**
- Create: `apps/web/lib/player/volume.ts`, `apps/web/lib/player/play-tracker.ts`, `apps/web/lib/player/player.ts`
- Test: `apps/web/lib/player/play-tracker.test.ts`, `apps/web/lib/player/player.test.ts`

**Interfaces:**
- Consumes:
  - `queue` (the reducer), `QueueState`, `QueueStep`, `QueueEnv` and `QueueContext` from `@riff/core`.
  - `AudioEngine` and `EngineEvents` from Task 4.
- Produces:
  - `toGain(slider)`, which returns slider².
  - `PlayTracker`: `new PlayTracker(record)` with `start(trackId, context?)`, `onTime(positionSec, audible)`, `onSeek(positionSec)` and `onEnded()`.
  - The types `PlayRecord { trackId: EntityId; msPlayed; context? }` and `RecordPlay`, plus the constant `COUNT_AFTER_MS`.
  - `createPlayer({ createEngine(events), env, recordPlay, notify }): Player`, where `Player = { store: StoreApi<PlayerState>; actions: PlayerActions }`.
  - `PlayerState { queue; status: 'idle'|'loading'|'playing'|'paused'|'ended'|'error'; position; duration: number | null; volume; muted }`.
  - `PlayerActions`:
    - playback: `playContext(tracks, startIndex, context)`, `togglePlay()`, `next()`, `prev()`, `seek(sec)`, `jumpTo(uid)`
    - queue: `addToQueue(tracks)`, `playNext(tracks)`, `removeFromQueue(uid)`, `moveInQueue(uid, toIndex)`, `clearUpNext()`, `toggleShuffle()`, `cycleRepeat()`
    - sound: `setVolume(v)`, `toggleMute()`
    - lifecycle: `restore(saved: SavedPlayer)`, `reset()`
  - `SavedPlayer { queue; position; volume; muted }`, `EngineLike`, and `MAX_CONSECUTIVE_FAILURES = 3`.
  - The engine is created on the first action that needs audio, never during server rendering.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/player/play-tracker.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PlayTracker, type RecordPlay } from './play-tracker';

let record: ReturnType<typeof vi.fn<RecordPlay>>;
let tracker: PlayTracker;

beforeEach(() => {
  record = vi.fn<RecordPlay>(async () => {});
  tracker = new PlayTracker(record);
});

/** Plays from `from` to `to` in 0.25 s steps, like the element's timeupdate events. */
function listen(from: number, to: number, audible = true) {
  for (let t = from; t <= to; t += 0.25) tracker.onTime(t, audible);
}

describe('PlayTracker', () => {
  test('records a play once 30 s have been heard, and only once', () => {
    tracker.start('audius:t1', 'playlist:p1');
    listen(0, 29.5);
    expect(record).not.toHaveBeenCalled();
    listen(29.75, 60);
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:p1',
    });
  });

  test('counts listening time, not position: seeking ahead does not count', () => {
    tracker.start('audius:t1');
    listen(0, 10);
    tracker.onSeek(170);
    listen(170, 179);
    tracker.onEnded();
    expect(record).toHaveBeenCalledWith({ trackId: 'audius:t1', msPlayed: 19_000 });
  });

  test('seeking back and listening again counts again', () => {
    tracker.start('audius:t1');
    listen(0, 20);
    tracker.onSeek(0);
    listen(0, 10);
    expect(record).toHaveBeenCalledOnce();
  });

  test('time while muted or paused does not count', () => {
    tracker.start('audius:t1');
    listen(0, 40, false);
    expect(record).not.toHaveBeenCalled();
  });

  test('a short track is recorded when it ends', () => {
    tracker.start('audius:t1');
    listen(0, 12);
    tracker.onEnded();
    expect(record).toHaveBeenCalledWith({ trackId: 'audius:t1', msPlayed: 12_000 });
  });

  test('nothing is recorded for a track that never played', () => {
    tracker.start('audius:t1');
    tracker.onEnded();
    tracker.start('audius:t2');
    expect(record).not.toHaveBeenCalled();
  });

  test('starting a new play resets the count', () => {
    tracker.start('audius:t1');
    listen(0, 20);
    tracker.start('audius:t2');
    listen(0, 20);
    expect(record).not.toHaveBeenCalled();
  });

  test('a failed post is swallowed', async () => {
    record.mockRejectedValueOnce(new Error('offline'));
    tracker.start('audius:t1');
    listen(0, 31);
    await Promise.resolve();
    expect(record).toHaveBeenCalledOnce();
  });
});
```

The store tests use the real engine over `FakeMedia`, so they cover the wiring between the two.

`apps/web/lib/player/player.test.ts`:

```ts
import { type QueueContext, queue as q, type StreamInfo } from '@riff/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeMedia } from '@/test/fake-media';
import { station, track, tracks } from '@/test/fixtures';
import { AudioEngine } from './engine';
import type { RecordPlay } from './play-tracker';
import { createPlayer, type Player } from './player';

const ctx: QueueContext = { type: 'playlist', id: 'p1', name: 'Mix' };

let media: FakeMedia;
let resolve: ReturnType<typeof vi.fn<(id: string) => Promise<StreamInfo>>>;
let record: ReturnType<typeof vi.fn<RecordPlay>>;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
let player: Player;

beforeEach(() => {
  media = new FakeMedia();
  resolve = vi.fn(async (id: string) => ({
    url: `https://a.test/${id}`,
    mirrors: [],
    live: false,
  }));
  record = vi.fn<RecordPlay>(async () => {});
  notify = vi.fn();
  let uid = 0;
  player = createPlayer({
    createEngine: (events) => new AudioEngine(media, resolve, events),
    env: { rng: () => 0.5, uid: () => `u${++uid}` },
    recordPlay: record,
    notify,
  });
});

const state = () => player.store.getState();
const currentId = () => state().queue.current?.track.id;
const settle = () => new Promise((done) => setTimeout(done, 0));

async function started() {
  await settle();
  media.emit('loadedmetadata');
  media.emit('playing');
}

describe('playback', () => {
  test('playContext loads and plays the chosen track', async () => {
    player.actions.playContext(tracks(3), 1, ctx);
    expect(state().status).toBe('loading');
    expect(state().duration).toBe(180);
    await started();
    expect(media.src).toBe('https://a.test/audius:t2');
    expect(state().status).toBe('playing');
    expect(currentId()).toBe('audius:t2');
  });

  test('an empty context changes nothing', () => {
    player.actions.playContext([], 0, ctx);
    expect(state().status).toBe('idle');
    expect(resolve).not.toHaveBeenCalled();
  });

  test('when a track ends, the next one plays', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    media.emit('ended');
    await started();
    expect(currentId()).toBe('audius:t2');
    expect(media.src).toBe('https://a.test/audius:t2');
  });

  test('at the end of the queue with repeat off, the player stops on the last track', async () => {
    player.actions.playContext(tracks(1), 0, ctx);
    await started();
    media.ended = true;
    media.emit('pause');
    media.emit('ended');
    expect(state().status).toBe('ended');
    expect(currentId()).toBe('audius:t1');
    // Play again from the start.
    media.ended = false;
    media.currentTime = 180;
    player.actions.togglePlay();
    expect(media.currentTime).toBe(0);
    expect(media.paused).toBe(false);
  });

  test('repeat one replays the same track', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    player.actions.cycleRepeat();
    player.actions.cycleRepeat();
    expect(state().queue.repeat).toBe('one');
    await started();
    media.currentTime = 180;
    media.emit('ended');
    expect(currentId()).toBe('audius:t1');
    expect(media.currentTime).toBe(0);
    expect(media.paused).toBe(false);
  });

  test('prev restarts after 3 s and goes back before that', async () => {
    player.actions.playContext(tracks(2), 1, ctx);
    await started();
    media.currentTime = 10;
    media.emit('timeupdate');
    player.actions.prev();
    expect(media.currentTime).toBe(0);
    expect(currentId()).toBe('audius:t2');
    media.emit('timeupdate');
    player.actions.prev();
    expect(currentId()).toBe('audius:t1');
  });

  test('togglePlay pauses and resumes', async () => {
    player.actions.playContext(tracks(1), 0, ctx);
    await started();
    player.actions.togglePlay();
    expect(media.paused).toBe(true);
    expect(state().status).toBe('paused');
    player.actions.togglePlay();
    expect(media.paused).toBe(false);
  });

  test('seek clamps to the track and updates the position at once', async () => {
    player.actions.playContext(tracks(1), 0, ctx);
    await started();
    player.actions.seek(500);
    expect(media.currentTime).toBe(180);
    expect(state().position).toBe(180);
    player.actions.seek(-5);
    expect(media.currentTime).toBe(0);
  });

  test('live stations cannot seek or go back', async () => {
    player.actions.playContext([station(1), station(2)], 1, {
      type: 'radio',
      name: 'Radio',
    });
    await started();
    expect(state().duration).toBeNull();
    media.currentTime = 100;
    media.emit('timeupdate');
    player.actions.seek(10);
    player.actions.prev();
    expect(media.currentTime).toBe(100);
    expect(currentId()).toBe(station(2).id);
  });

  test('adding to an idle queue starts playing it', async () => {
    player.actions.addToQueue([track(7)]);
    await started();
    expect(currentId()).toBe('audius:t7');
    expect(state().status).toBe('playing');
  });

  test('queued items play before the context continues', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    player.actions.playNext([track(9)]);
    await started();
    media.emit('ended');
    expect(currentId()).toBe('audius:t9');
  });
});

describe('failures', () => {
  test('a track that cannot play is announced and skipped', async () => {
    resolve.mockRejectedValueOnce(new Error('502'));
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    expect(notify).toHaveBeenCalledWith('Couldn’t play “Track 1”. Skipping.');
    expect(currentId()).toBe('audius:t2');
    expect(state().status).toBe('playing');
  });

  test('stops instead of skipping through the whole queue when nothing plays', async () => {
    resolve.mockRejectedValue(new Error('offline'));
    player.actions.playContext(tracks(10), 0, ctx);
    await settle();
    await settle();
    await settle();
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(state().status).toBe('error');
    expect(notify).toHaveBeenLastCalledWith(
      'Playback stopped: several tracks in a row failed. Check your connection.',
    );
  });

  test('a failure on the last track leaves the player in the error state', async () => {
    resolve.mockRejectedValue(new Error('502'));
    player.actions.playContext(tracks(1), 0, ctx);
    await settle();
    expect(state().status).toBe('error');
  });
});

describe('volume', () => {
  test('maps the slider to a perceptual gain and unmutes when raised', () => {
    player.actions.toggleMute();
    expect(media.muted).toBe(true);
    player.actions.setVolume(0.5);
    expect(media.volume).toBe(0.25);
    expect(state().volume).toBe(0.5);
    expect(state().muted).toBe(false);
    expect(media.muted).toBe(false);
  });
});

describe('history and prefetch', () => {
  test('records the play with its context after 30 s of listening', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    for (let t = 0; t <= 31; t += 0.25) {
      media.currentTime = t;
      media.emit('timeupdate');
    }
    expect(record).toHaveBeenCalledWith({
      trackId: 'audius:t1',
      msPlayed: 30_000,
      context: 'playlist:p1',
    });
  });

  test('queued items are recorded without the context', async () => {
    player.actions.addToQueue([track(7)]);
    await started();
    for (let t = 0; t <= 31; t += 0.25) {
      media.currentTime = t;
      media.emit('timeupdate');
    }
    expect(record).toHaveBeenCalledWith({ trackId: 'audius:t7', msPlayed: 30_000 });
  });

  test('prefetches the next track once the current one plays', async () => {
    player.actions.playContext(tracks(3), 0, ctx);
    await started();
    await settle();
    expect(resolve).toHaveBeenCalledWith('audius:t2');
    media.emit('ended');
    await settle();
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe('restore and reset', () => {
  test('restores paused at the saved position and loads only on play', async () => {
    const queue = q.playContext(q.emptyQueue, tracks(3), 1, ctx, { rng: () => 0, uid: () => 'x' });
    player.actions.restore({ queue, position: 75, volume: 0.8, muted: false });
    expect(state()).toMatchObject({ status: 'paused', position: 75, volume: 0.8 });
    expect(media.volume).toBeCloseTo(0.64);
    expect(resolve).not.toHaveBeenCalled();
    player.actions.togglePlay();
    await started();
    expect(media.src).toBe('https://a.test/audius:t2');
    expect(media.currentTime).toBe(75);
  });

  test('restoring an empty queue leaves the player idle', () => {
    player.actions.restore({ queue: q.emptyQueue, position: 0, volume: 1, muted: false });
    expect(state().status).toBe('idle');
  });

  test('reset stops playback and forgets the queue', async () => {
    player.actions.playContext(tracks(2), 0, ctx);
    await started();
    player.actions.reset();
    expect(media.src).toBe('');
    expect(state().queue).toEqual(q.emptyQueue);
    expect(state().status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run lib/player/play-tracker lib/player/player`
Expected: both FAIL with `Failed to resolve import` (`./play-tracker`, `./player`).

- [ ] **Step 3: Write the volume mapping, the play tracker and the store**

`apps/web/lib/player/volume.ts`:

```ts
/** Slider position (0..1) to element volume: squaring matches how loudness is perceived. */
export const toGain = (slider: number): number => {
  const clamped = Math.min(Math.max(slider, 0), 1);
  return clamped * clamped;
};
```

`apps/web/lib/player/play-tracker.ts`:

```ts
import type { EntityId } from '@riff/core';

export interface PlayRecord {
  trackId: EntityId;
  msPlayed: number;
  context?: string;
}

export type RecordPlay = (play: PlayRecord) => Promise<void>;

/** A play counts once this much has been heard (or at the end of a shorter track). */
export const COUNT_AFTER_MS = 30_000;
/** Position jumps larger than this between timeupdates are seeks, not listening. */
const MAX_STEP_SEC = 2;

/**
 * Accumulates audible listening time for the current play and records the play once:
 * at 30 s, or when a shorter track ends.
 */
export class PlayTracker {
  private trackId: EntityId | null = null;
  private context: string | undefined;
  private heardMs = 0;
  private lastPosition: number | null = null;
  private recorded = false;

  constructor(private readonly record: RecordPlay) {}

  start(trackId: EntityId, context?: string): void {
    this.trackId = trackId;
    this.context = context;
    this.heardMs = 0;
    this.lastPosition = null;
    this.recorded = false;
  }

  onTime(positionSec: number, audible: boolean): void {
    const step = this.lastPosition === null ? 0 : positionSec - this.lastPosition;
    this.lastPosition = positionSec;
    if (!audible || step <= 0 || step > MAX_STEP_SEC) return;
    this.heardMs += step * 1000;
    if (this.heardMs >= COUNT_AFTER_MS) this.flush();
  }

  onSeek(positionSec: number): void {
    this.lastPosition = positionSec;
  }

  onEnded(): void {
    if (this.heardMs > 0) this.flush();
  }

  private flush(): void {
    if (this.recorded || !this.trackId) return;
    this.recorded = true;
    const play: PlayRecord = { trackId: this.trackId, msPlayed: Math.round(this.heardMs) };
    if (this.context) play.context = this.context;
    this.record(play).catch(() => {
      // History is best-effort; a lost play only affects Home's "recently played".
    });
  }
}
```

`apps/web/lib/player/player.ts`:

```ts
import {
  type QueueContext,
  type QueueEnv,
  type QueueState,
  type QueueStep,
  queue as q,
  type Track,
} from '@riff/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AudioEngine, EngineEvents } from './engine';
import { PlayTracker, type RecordPlay } from './play-tracker';
import { toGain } from './volume';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlayerState {
  queue: QueueState;
  status: PlayerStatus;
  /** Seconds into the current track. */
  position: number;
  /** Seconds; null for live streams and before anything is loaded. */
  duration: number | null;
  /** Slider position in [0, 1]; the element's volume is its square. */
  volume: number;
  muted: boolean;
}

/** What the player saves across reloads (see persistence.ts). */
export interface SavedPlayer {
  queue: QueueState;
  position: number;
  volume: number;
  muted: boolean;
}

export type EngineLike = Pick<
  AudioEngine,
  | 'loadedTrackId'
  | 'load'
  | 'play'
  | 'pause'
  | 'seek'
  | 'setVolume'
  | 'setMuted'
  | 'prefetch'
  | 'unload'
>;

export interface PlayerDeps {
  /** Called once, on the first action that needs audio (never during server rendering). */
  createEngine(events: EngineEvents): EngineLike;
  env: QueueEnv;
  recordPlay: RecordPlay;
  /** Shows a transient message (a toast in the app). */
  notify(message: string): void;
}

export interface PlayerActions {
  playContext(tracks: readonly Track[], startIndex: number, context: QueueContext): void;
  togglePlay(): void;
  next(): void;
  prev(): void;
  seek(positionSec: number): void;
  jumpTo(uid: string): void;
  addToQueue(tracks: readonly Track[]): void;
  playNext(tracks: readonly Track[]): void;
  removeFromQueue(uid: string): void;
  moveInQueue(uid: string, toIndex: number): void;
  clearUpNext(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  restore(saved: SavedPlayer): void;
  reset(): void;
}

export interface Player {
  store: StoreApi<PlayerState>;
  actions: PlayerActions;
}

/** After this many tracks fail in a row, stop instead of skipping through the whole queue. */
export const MAX_CONSECUTIVE_FAILURES = 3;

const initialState: PlayerState = {
  queue: q.emptyQueue,
  status: 'idle',
  position: 0,
  duration: null,
  volume: 1,
  muted: false,
};

/** The history `context` for a play: the queue context, unless the item was queued by hand. */
function historyContext(queue: QueueState): string | undefined {
  if (!queue.context || queue.currentFromUpNext) return undefined;
  const { type, id } = queue.context;
  return id ? `${type}:${id}` : type;
}

/**
 * The player: queue state from `@riff/core`, playback status, and the audio engine, wired
 * together. React reads `store`; everything else calls `actions`.
 */
export function createPlayer(deps: PlayerDeps): Player {
  const store = createStore<PlayerState>()(() => initialState);
  const { getState: get, setState: set } = store;
  const tracker = new PlayTracker(deps.recordPlay);
  let failures = 0;
  /** uid of the play whose next item has been prefetched. */
  let prefetchedAfter: string | null = null;

  const events: EngineEvents = {
    onStatus(status) {
      if (status === 'playing') {
        failures = 0;
        prefetchNext();
      }
      // A late `pause` from the element must not hide the ended or error state.
      const current = get().status;
      if (status === 'paused' && (current === 'ended' || current === 'error')) return;
      set({ status });
    },
    onTime(position) {
      const { status, muted, volume } = get();
      tracker.onTime(position, status === 'playing' && !muted && volume > 0);
      set({ position });
    },
    onDuration(duration) {
      set({ duration: duration ?? get().queue.current?.track.durationSec ?? null });
    },
    onEnded() {
      tracker.onEnded();
      apply(q.trackEnded(get().queue, deps.env));
    },
    onFailed(track) {
      failures++;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        engine().unload();
        set({ status: 'error' });
        deps.notify('Playback stopped: several tracks in a row failed. Check your connection.');
        return;
      }
      deps.notify(`Couldn’t play “${track.title}”. Skipping.`);
      const step = q.next(get().queue, deps.env);
      if (step.effect === 'play') apply(step);
      else set({ status: 'error' });
    },
  };

  let engineInstance: EngineLike | null = null;
  const engine = (): EngineLike => {
    engineInstance ??= deps.createEngine(events);
    return engineInstance;
  };

  function startCurrent(startAt = 0): void {
    const { queue } = get();
    const item = queue.current;
    if (!item) return;
    tracker.start(item.track.id, historyContext(queue));
    prefetchedAfter = null;
    set({ status: 'loading', position: startAt, duration: item.track.durationSec });
    void engine().load(item.track, { autoplay: true, startAt });
  }

  function restart(): void {
    const item = get().queue.current;
    if (!item) return;
    tracker.start(item.track.id, historyContext(get().queue));
    engine().seek(0);
    set({ position: 0 });
    void engine().play();
  }

  function apply(step: QueueStep): void {
    set({ queue: step.state });
    if (step.effect === 'play') startCurrent();
    else if (step.effect === 'restart') restart();
    else if (step.effect === 'stop') {
      engine().pause();
      set({ status: 'ended' });
    }
  }

  function prefetchNext(): void {
    const { queue } = get();
    const current = queue.current;
    if (!current || prefetchedAfter === current.uid) return;
    prefetchedAfter = current.uid;
    const following = q.upcoming(queue)[0];
    if (following) void engine().prefetch(following.track);
  }

  const isLive = () => get().queue.current?.track.isLive ?? false;

  const actions: PlayerActions = {
    playContext(tracks, startIndex, context) {
      const before = get().queue;
      const queue = q.playContext(before, tracks, startIndex, context, deps.env);
      if (queue === before) return;
      failures = 0;
      set({ queue });
      startCurrent();
    },

    togglePlay() {
      const { queue, status, position } = get();
      const current = queue.current;
      if (!current) return;
      if (status === 'playing' || status === 'loading') {
        engine().pause();
        set({ status: 'paused' });
        return;
      }
      failures = 0;
      if (engine().loadedTrackId !== current.track.id) {
        // Restored from storage, or unloaded after errors: load it where it was.
        startCurrent(status === 'ended' || current.track.isLive ? 0 : position);
      } else if (status === 'ended') {
        restart();
      } else {
        void engine().play();
      }
    },

    next() {
      apply(q.next(get().queue, deps.env));
    },

    prev() {
      if (isLive()) return;
      apply(q.prev(get().queue, get().position));
    },

    seek(positionSec) {
      const { queue, duration } = get();
      if (!queue.current || isLive()) return;
      const max = duration ?? queue.current.track.durationSec ?? 0;
      const position = Math.min(Math.max(positionSec, 0), max);
      engine().seek(position);
      tracker.onSeek(position);
      set({ position });
    },

    jumpTo(uid) {
      apply(q.jumpTo(get().queue, uid));
    },

    addToQueue(tracks) {
      const queue = q.addToQueue(get().queue, tracks, deps.env);
      set({ queue });
      // With nothing loaded, adding to the queue starts it.
      if (!queue.current) apply(q.next(queue, deps.env));
    },

    playNext(tracks) {
      const queue = q.playNext(get().queue, tracks, deps.env);
      set({ queue });
      if (!queue.current) apply(q.next(queue, deps.env));
    },

    removeFromQueue(uid) {
      set({ queue: q.removeFromQueue(get().queue, uid) });
    },

    moveInQueue(uid, toIndex) {
      set({ queue: q.moveInQueue(get().queue, uid, toIndex) });
    },

    clearUpNext() {
      set({ queue: q.clearUpNext(get().queue) });
    },

    toggleShuffle() {
      set({ queue: q.toggleShuffle(get().queue, deps.env) });
    },

    cycleRepeat() {
      set({ queue: q.cycleRepeat(get().queue) });
    },

    setVolume(volume) {
      const clamped = Math.min(Math.max(volume, 0), 1);
      engine().setVolume(toGain(clamped));
      const muted = clamped > 0 ? false : get().muted;
      engine().setMuted(muted);
      set({ volume: clamped, muted });
    },

    toggleMute() {
      const muted = !get().muted;
      engine().setMuted(muted);
      set({ muted });
    },

    restore(saved) {
      const current = saved.queue.current;
      engine().setVolume(toGain(saved.volume));
      engine().setMuted(saved.muted);
      set({
        queue: saved.queue,
        status: current ? 'paused' : 'idle',
        position: current && !current.track.isLive ? saved.position : 0,
        duration: current?.track.durationSec ?? null,
        volume: saved.volume,
        muted: saved.muted,
      });
    },

    reset() {
      engine().unload();
      failures = 0;
      prefetchedAfter = null;
      set({ ...initialState, volume: get().volume, muted: get().muted });
    },
  };

  return { store, actions };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @riff/web exec vitest run lib/player && pnpm --filter @riff/web typecheck`
Expected: `Tests  52 passed (52)`: engine 23, play tracker 8, player 21. No type errors.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add the player store with queue effects, failure skipping and play history"
```

### Task 6: Browser integrations: persistence, Media Session, shortcuts and the app's player

**Files:**
- Create: `apps/web/lib/player/persistence.ts`, `apps/web/lib/player/media-session.ts`, `apps/web/lib/player/shortcuts.ts`, `apps/web/lib/player/remote.ts`, `apps/web/lib/player/instance.ts`, `apps/web/components/player/player-runtime.tsx`, `apps/web/test/test-player.ts`
- Test: `apps/web/lib/player/persistence.test.ts`, `apps/web/lib/player/media-session.test.ts`, `apps/web/lib/player/shortcuts.test.tsx`, `apps/web/lib/player/remote.test.ts`

**Interfaces:**
- Consumes:
  - `createPlayer`, `Player`, `PlayerState` and `SavedPlayer` from Task 5.
  - `QueueStateSchema` and `StreamInfoSchema` from `@riff/core`.
  - `api`, `unwrap` and `expectOk` from Task 3.
- Produces:
  - `persistence.ts`:
    - `STORAGE_KEY = 'riff:player:v1'`, `SAVE_INTERVAL_MS`
    - `loadSavedPlayer(storage): SavedPlayer | null`, `clearSavedPlayer(storage)`
    - `persistPlayer(player, storage, target): () => void`: restores, then saves every 5 s when something changed and on `pagehide`. It returns a function that stops saving.
  - `media-session.ts`:
    - `MediaSessionLike`, `metadataFor(track)`, `SEEK_OFFSET_SEC = 10`
    - `bindMediaSession(player, session, toMetadata): () => void`
  - `shortcuts.ts`:
    - `ShortcutAction = 'togglePlay'|'seekBack'|'seekForward'|'prev'|'next'|'toggleMute'|'like'|'focusSearch'`
    - `ShortcutHandlers`, `SEEK_STEP_SEC = 5`
    - `shortcutFor(event): ShortcutAction | null`, `useShortcuts(handlers)`
  - `remote.ts`: `resolveStream(id): Promise<StreamInfo>`, `recordPlay(play): Promise<void>`.
  - `instance.ts`:
    - `player`: the app's player. Its engine uses an `<audio id="riff-audio" hidden>` appended to `<body>`, `crypto.randomUUID()` for queue uids (Plan 1 handoff), and sonner toasts for `notify`.
    - `usePlayer(selector)`.
  - `components/player/player-runtime.tsx`: `<PlayerRuntime />`, which restores and saves the player and binds Media Session. It renders nothing.
  - `test/test-player.ts`: `createTestPlayer()`, which returns `{ player, media, resolve }` over `FakeMedia`.

- [ ] **Step 1: Write the test player and the failing tests**

`apps/web/test/test-player.ts`:

```ts
import type { StreamInfo } from '@riff/core';
import { vi } from 'vitest';
import { AudioEngine } from '@/lib/player/engine';
import { createPlayer } from '@/lib/player/player';
import { FakeMedia } from '@/test/fake-media';

/** A real player over a fake media element, for tests of the browser integrations. */
export function createTestPlayer() {
  const media = new FakeMedia();
  const resolve = vi.fn(
    async (id: string): Promise<StreamInfo> => ({
      url: `https://a.test/${id}`,
      mirrors: [],
      live: false,
    }),
  );
  let uid = 0;
  const player = createPlayer({
    createEngine: (events) => new AudioEngine(media, resolve, events),
    env: { rng: () => 0.5, uid: () => `u${++uid}` },
    recordPlay: vi.fn(async () => {}),
    notify: vi.fn(),
  });
  return { player, media, resolve };
}
```

`apps/web/lib/player/persistence.test.ts`:

```ts
import { type QueueContext, queue as q } from '@riff/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tracks } from '@/test/fixtures';
import { createTestPlayer } from '@/test/test-player';
import { clearSavedPlayer, loadSavedPlayer, persistPlayer, STORAGE_KEY } from './persistence';

const ctx: QueueContext = { type: 'liked', name: 'Liked Songs' };
const env = { rng: () => 0.5, uid: () => crypto.randomUUID() };

const savedState = () => ({
  queue: q.playContext(q.emptyQueue, tracks(3), 2, ctx, env),
  position: 42.5,
  volume: 0.6,
  muted: false,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadSavedPlayer', () => {
  test('reads back what was saved', () => {
    const saved = savedState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    expect(loadSavedPlayer(localStorage)).toEqual(saved);
  });

  test.each([
    ['broken JSON', '{"queue":'],
    ['a different shape', JSON.stringify({ tracks: [] })],
    ['an out-of-range volume', JSON.stringify({ ...savedState(), volume: 7 })],
  ])('drops %s and removes it', (_, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadSavedPlayer(localStorage)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('treats storage that throws as empty', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {},
    } as unknown as Storage;
    expect(loadSavedPlayer(storage)).toBeNull();
  });
});

describe('persistPlayer', () => {
  test('restores the saved queue paused at its position', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState()));
    const { player, resolve } = createTestPlayer();
    const stop = persistPlayer(player, localStorage, window);
    expect(player.store.getState()).toMatchObject({ status: 'paused', position: 42.5 });
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t3');
    expect(resolve).not.toHaveBeenCalled();
    stop();
  });

  test('saves every 5 seconds while something changed, and on pagehide', () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { player } = createTestPlayer();
    const stop = persistPlayer(player, localStorage, window);
    player.actions.playContext(tracks(2), 0, ctx);
    vi.advanceTimersByTime(5_000);
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(setItem).toHaveBeenCalledTimes(1);
    player.store.setState({ position: 12 });
    window.dispatchEvent(new Event('pagehide'));
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(loadSavedPlayer(localStorage)?.position).toBe(12);
    stop();
    player.store.setState({ position: 13 });
    vi.advanceTimersByTime(5_000);
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  test('a full or disabled storage does not break playback', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const { player } = createTestPlayer();
    const stop = persistPlayer(player, localStorage, window);
    player.actions.playContext(tracks(2), 0, ctx);
    expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
    stop();
  });

  test('clearSavedPlayer forgets the saved state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState()));
    clearSavedPlayer(localStorage);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
```

`apps/web/lib/player/media-session.test.ts`:

```ts
import type { QueueContext } from '@riff/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { station, tracks } from '@/test/fixtures';
import { createTestPlayer } from '@/test/test-player';
import { bindMediaSession, type MediaSessionLike } from './media-session';

const ctx: QueueContext = { type: 'playlist', id: 'p1', name: 'Mix' };

class FakeMediaSession implements MediaSessionLike {
  metadata: MediaMetadataInit | null = null;
  playbackState: MediaSessionPlaybackState = 'none';
  handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  setPositionState = vi.fn();
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    this.handlers.set(action, handler);
  }
  fire(action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}) {
    this.handlers.get(action)?.({ action, ...details });
  }
}

let session: FakeMediaSession;
const toMetadata = (init: MediaMetadataInit) => init;

beforeEach(() => {
  vi.useFakeTimers();
  session = new FakeMediaSession();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bindMediaSession', () => {
  test('publishes the current track with every artwork size', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext(tracks(2), 0, ctx);
    expect(session.metadata).toEqual({
      title: 'Track 1',
      artist: 'Artist 1',
      album: '',
      artwork: [
        { src: 'https://img.test/1-150.jpg', sizes: '150x150' },
        { src: 'https://img.test/1-480.jpg', sizes: '480x480' },
      ],
    });
    stop();
  });

  test('mirrors the playback state', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    expect(session.playbackState).toBe('none');
    player.actions.playContext(tracks(1), 0, ctx);
    player.store.setState({ status: 'playing' });
    expect(session.playbackState).toBe('playing');
    player.store.setState({ status: 'paused' });
    expect(session.playbackState).toBe('paused');
    stop();
  });

  test('routes OS controls to the player', () => {
    const { player } = createTestPlayer();
    const next = vi.spyOn(player.actions, 'next');
    const prev = vi.spyOn(player.actions, 'prev');
    const seek = vi.spyOn(player.actions, 'seek');
    const toggle = vi.spyOn(player.actions, 'togglePlay');
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext(tracks(2), 0, ctx);
    player.store.setState({ status: 'playing', position: 50 });
    session.fire('nexttrack');
    session.fire('previoustrack');
    session.fire('seekto', { seekTime: 90 });
    session.fire('seekforward', {});
    session.fire('seekbackward', { seekOffset: 30 });
    session.fire('play');
    session.fire('pause');
    expect(next).toHaveBeenCalledOnce();
    expect(prev).toHaveBeenCalledOnce();
    // Each seek moves the position the next relative seek starts from.
    expect(seek.mock.calls).toEqual([[90], [100], [70]]);
    // "play" while already playing does nothing; "pause" toggles.
    expect(toggle).toHaveBeenCalledOnce();
    stop();
  });

  test('updates the position state every second, but not for live streams', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext(tracks(1), 0, ctx);
    player.store.setState({ status: 'playing', position: 12, duration: 180 });
    vi.advanceTimersByTime(1_000);
    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 180,
      playbackRate: 1,
      position: 12,
    });
    session.setPositionState.mockClear();
    player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' });
    player.store.setState({ status: 'playing', position: 30, duration: null });
    vi.advanceTimersByTime(3_000);
    expect(session.setPositionState).not.toHaveBeenCalled();
    stop();
  });

  test('live stations disable seeking and previous in the OS controls', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' });
    expect(session.handlers.get('seekto')).toBeNull();
    expect(session.handlers.get('previoustrack')).toBeNull();
    player.actions.playContext(tracks(1), 0, ctx);
    expect(session.handlers.get('seekto')).toBeTypeOf('function');
    stop();
  });

  test('cleanup removes every handler', () => {
    const { player } = createTestPlayer();
    const stop = bindMediaSession(player, session, toMetadata);
    stop();
    expect([...session.handlers.values()].every((handler) => handler === null)).toBe(true);
  });
});
```

`apps/web/lib/player/shortcuts.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { type ShortcutHandlers, shortcutFor, useShortcuts } from './shortcuts';

function keydown(key: string, init: KeyboardEventInit = {}, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

function captured(key: string, init: KeyboardEventInit = {}, target?: HTMLElement) {
  let result: ReturnType<typeof shortcutFor> = null;
  const listener = (event: KeyboardEvent) => {
    result = shortcutFor(event);
  };
  window.addEventListener('keydown', listener);
  keydown(key, init, target);
  window.removeEventListener('keydown', listener);
  return result;
}

describe('shortcutFor', () => {
  test.each([
    [' ', {}, 'togglePlay'],
    ['ArrowLeft', {}, 'seekBack'],
    ['ArrowRight', {}, 'seekForward'],
    ['ArrowLeft', { shiftKey: true }, 'prev'],
    ['ArrowRight', { shiftKey: true }, 'next'],
    ['m', {}, 'toggleMute'],
    ['M', { shiftKey: true }, 'toggleMute'],
    ['l', {}, 'like'],
    ['/', {}, 'focusSearch'],
  ])('%j %j is %s', (key, init, action) => {
    expect(captured(key, init)).toBe(action);
  });

  test.each([
    ['k', {}],
    ['ArrowRight', { ctrlKey: true }],
    ['l', { metaKey: true }],
    ['m', { altKey: true }],
    [' ', { repeat: true }],
  ])('ignores %j %j', (key, init) => {
    expect(captured(key, init)).toBeNull();
  });

  test.each([
    ['input', '<input type="text" />'],
    ['search input', '<input type="search" />'],
    ['textarea', '<textarea></textarea>'],
    ['editable element', '<div contenteditable="true"></div>'],
  ])('ignores keys typed into a %s', (_, html) => {
    document.body.innerHTML = html;
    const field = document.body.firstElementChild as HTMLElement;
    expect(captured('m', {}, field)).toBeNull();
    expect(captured(' ', {}, field)).toBeNull();
  });

  test('Space on a focused button presses the button instead', () => {
    document.body.innerHTML = '<button>Like</button>';
    const button = document.body.firstElementChild as HTMLElement;
    expect(captured(' ', {}, button)).toBeNull();
    expect(captured('ArrowRight', {}, button)).toBe('seekForward');
  });

  test('keys a widget already handled are left alone', () => {
    document.body.innerHTML = '<span role="slider" tabindex="0"></span>';
    const slider = document.body.firstElementChild as HTMLElement;
    slider.addEventListener('keydown', (event) => event.preventDefault());
    expect(captured('ArrowRight', {}, slider)).toBeNull();
  });
});

describe('useShortcuts', () => {
  function Harness({ handlers }: { handlers: ShortcutHandlers }) {
    useShortcuts(handlers);
    return null;
  }

  test('runs the handler and prevents the browser default (e.g. Space scrolling)', () => {
    const handlers = {
      togglePlay: vi.fn(),
      seekBack: vi.fn(),
      seekForward: vi.fn(),
      prev: vi.fn(),
      next: vi.fn(),
      toggleMute: vi.fn(),
      like: vi.fn(),
      focusSearch: vi.fn(),
    };
    const { unmount } = render(<Harness handlers={handlers} />);
    const event = keydown(' ');
    expect(handlers.togglePlay).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    fireEvent.keyDown(window, { key: 'l' });
    expect(handlers.like).toHaveBeenCalledOnce();
    unmount();
    keydown(' ');
    expect(handlers.togglePlay).toHaveBeenCalledOnce();
  });
});
```

`apps/web/lib/player/remote.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { recordPlay, resolveStream } from './remote';

afterEach(() => vi.unstubAllGlobals());

test('resolveStream asks the API for the stream as JSON', async () => {
  const info = { url: 'https://a.test/1', mirrors: ['https://b.test/1'], live: false };
  const fetch = vi.fn(async () => Response.json(info));
  vi.stubGlobal('fetch', fetch);
  await expect(resolveStream('audius:t1')).resolves.toEqual(info);
  expect(fetch).toHaveBeenCalledWith('/api/stream/audius:t1?format=json', expect.anything());
});

test('resolveStream rejects when the API fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: { code: 'UPSTREAM_ERROR', message: 'down' } }, { status: 502 }),
    ),
  );
  await expect(resolveStream('audius:t1')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
});

test('recordPlay posts the play', async () => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetch);
  await recordPlay({ trackId: 'audius:t1', msPlayed: 30_000, context: 'liked' });
  const [url, init] = fetch.mock.calls[0] ?? [];
  expect(url).toBe('/api/me/history');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({
    trackId: 'audius:t1',
    msPlayed: 30_000,
    context: 'liked',
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run lib/player`
Expected: the four new files FAIL with `Failed to resolve import` (`./persistence`, `./media-session`, `./shortcuts`, `./remote`). The Task 4 and 5 suites still pass.

- [ ] **Step 3: Write persistence, Media Session, shortcuts and the remote calls**

`apps/web/lib/player/persistence.ts`:

```ts
import { QueueStateSchema } from '@riff/core';
import { z } from 'zod';
import type { Player, PlayerState, SavedPlayer } from './player';

export const STORAGE_KEY = 'riff:player:v1';
export const SAVE_INTERVAL_MS = 5_000;

const SavedPlayerSchema = z.object({
  queue: QueueStateSchema,
  position: z.number().nonnegative(),
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
});

/** The saved player, or null when there is none or it is unreadable (then it is removed). */
export function loadSavedPlayer(storage: Storage): SavedPlayer | null {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const result = SavedPlayerSchema.safeParse(parsed);
  if (result.success) return result.data;
  clearSavedPlayer(storage);
  return null;
}

export function clearSavedPlayer(storage: Storage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

const snapshot = ({ queue, position, volume, muted }: PlayerState): SavedPlayer => ({
  queue,
  position,
  volume,
  muted,
});

const sameSnapshot = (a: SavedPlayer, b: SavedPlayer) =>
  a.queue === b.queue && a.position === b.position && a.volume === b.volume && a.muted === b.muted;

/**
 * Restores the saved player (paused), then saves it every 5 s when it changed and on `pagehide`.
 * Returns a function that stops saving.
 */
export function persistPlayer(player: Player, storage: Storage, target: EventTarget): () => void {
  const saved = loadSavedPlayer(storage);
  if (saved) player.actions.restore(saved);
  let last = snapshot(player.store.getState());

  const write = () => {
    const next = snapshot(player.store.getState());
    if (sameSnapshot(next, last)) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
      last = next;
    } catch {
      // Full or disabled storage: the queue just won't survive a reload.
    }
  };

  const timer = setInterval(write, SAVE_INTERVAL_MS);
  target.addEventListener('pagehide', write);
  return () => {
    clearInterval(timer);
    target.removeEventListener('pagehide', write);
  };
}
```

`apps/web/lib/player/media-session.ts`:

```ts
import type { Track } from '@riff/core';
import type { Player, PlayerState } from './player';

/** The parts of `navigator.mediaSession` the player uses. */
export interface MediaSessionLike {
  metadata: MediaMetadata | MediaMetadataInit | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  setPositionState(state?: MediaPositionState): void;
}

export const SEEK_OFFSET_SEC = 10;

const ARTWORK_SIZES = [
  ['sm', '150x150'],
  ['md', '480x480'],
  ['lg', '1000x1000'],
] as const;

export function metadataFor(track: Track): MediaMetadataInit {
  return {
    title: track.title,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album?.title ?? '',
    artwork: ARTWORK_SIZES.flatMap(([size, sizes]) => {
      const src = track.artwork[size];
      return src ? [{ src, sizes }] : [];
    }),
  };
}

const ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward',
];

/**
 * Connects the OS media controls (lock screen, media keys, headsets) to the player.
 * `toMetadata` is `(init) => new MediaMetadata(init)` in the browser.
 */
export function bindMediaSession(
  player: Player,
  session: MediaSessionLike,
  toMetadata: (init: MediaMetadataInit) => MediaMetadata | MediaMetadataInit,
): () => void {
  const { store, actions } = player;
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Browsers throw for actions they do not support.
    }
  };

  const isPlaying = () => ['playing', 'loading'].includes(store.getState().status);
  set('play', () => {
    if (!isPlaying()) actions.togglePlay();
  });
  set('pause', () => {
    if (isPlaying()) actions.togglePlay();
  });
  set('nexttrack', () => actions.next());

  const bindSeeking = (live: boolean) => {
    set('previoustrack', live ? null : () => actions.prev());
    set('seekto', live ? null : (details) => actions.seek(details.seekTime ?? 0));
    set(
      'seekbackward',
      live
        ? null
        : (details) =>
            actions.seek(store.getState().position - (details.seekOffset ?? SEEK_OFFSET_SEC)),
    );
    set(
      'seekforward',
      live
        ? null
        : (details) =>
            actions.seek(store.getState().position + (details.seekOffset ?? SEEK_OFFSET_SEC)),
    );
  };

  const sync = (state: PlayerState, previous: PlayerState | null) => {
    const track = state.queue.current?.track ?? null;
    if (track !== (previous?.queue.current?.track ?? null)) {
      session.metadata = track ? toMetadata(metadataFor(track)) : null;
      bindSeeking(track?.isLive ?? false);
    }
    session.playbackState =
      state.status === 'playing' || state.status === 'loading'
        ? 'playing'
        : state.queue.current
          ? 'paused'
          : 'none';
  };

  sync(store.getState(), null);
  const unsubscribe = store.subscribe(sync);

  const timer = setInterval(() => {
    const { status, position, duration, queue } = store.getState();
    if (status !== 'playing' || queue.current?.track.isLive || !duration) return;
    try {
      session.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(position, duration),
      });
    } catch {
      // Invalid states (e.g. a duration change mid-update) are skipped until the next tick.
    }
  }, 1_000);

  return () => {
    unsubscribe();
    clearInterval(timer);
    for (const action of ACTIONS) set(action, null);
  };
}
```

Space is left to buttons, links and other widgets that Space activates. Arrow keys are left to widgets that already handled them (Radix sliders and menus call `preventDefault`).

`apps/web/lib/player/shortcuts.ts`:

```ts
import { useEffect, useRef } from 'react';

export type ShortcutAction =
  | 'togglePlay'
  | 'seekBack'
  | 'seekForward'
  | 'prev'
  | 'next'
  | 'toggleMute'
  | 'like'
  | 'focusSearch';

export type ShortcutHandlers = Record<ShortcutAction, () => void>;

/** Seconds moved by ← and →. */
export const SEEK_STEP_SEC = 5;

const TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range']);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
  if (target instanceof HTMLInputElement) return !TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Elements that Space activates by itself. */
const ACTIVATES_ON_SPACE =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="slider"], [role="link"]';

/** The player shortcut for a keydown, or null when the key belongs to something else. */
export function shortcutFor(event: KeyboardEvent): ShortcutAction | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTyping(event.target)) return null;
  switch (event.key) {
    case ' ': {
      if (event.repeat) return null;
      const target = event.target;
      if (target instanceof Element && target.closest(ACTIVATES_ON_SPACE)) return null;
      return 'togglePlay';
    }
    case 'ArrowLeft':
      return event.shiftKey ? 'prev' : 'seekBack';
    case 'ArrowRight':
      return event.shiftKey ? 'next' : 'seekForward';
    case 'm':
    case 'M':
      return 'toggleMute';
    case 'l':
    case 'L':
      return 'like';
    case '/':
      return 'focusSearch';
    default:
      return null;
  }
}

/** Binds the player shortcuts to the window for as long as the calling component is mounted. */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      latest.current[action]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
```

The stream route also redirects when called without `?format=json`, so its client type is a union. `resolveStream` therefore parses the body with `StreamInfoSchema`.

`apps/web/lib/player/remote.ts`:

```ts
import { type StreamInfo, StreamInfoSchema } from '@riff/core';
import { api, expectOk, unwrap } from '@/lib/api';
import type { PlayRecord } from './play-tracker';

/** Resolves a track's playable URL and mirrors (signed URLs; never cached). */
export const resolveStream = (id: string): Promise<StreamInfo> =>
  // The route also redirects (without ?format=json), so its client type is a union; parse it.
  unwrap(api.stream[':id'].$get({ param: { id }, query: { format: 'json' } })).then((body) =>
    StreamInfoSchema.parse(body),
  );

export const recordPlay = (play: PlayRecord): Promise<void> =>
  expectOk(api.me.history.$post({ json: play }));
```

- [ ] **Step 4: Create the app's player and its runtime**

`apps/web/lib/player/instance.ts`:

```ts
import { toast } from 'sonner';
import { useStore } from 'zustand';
import { AudioEngine } from './engine';
import { createPlayer, type PlayerState } from './player';
import { recordPlay, resolveStream } from './remote';

/** The one audio element, kept in the document so devtools and the smoke test can find it. */
function createAudioElement(): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.id = 'riff-audio';
  audio.hidden = true;
  document.body.append(audio);
  return audio;
}

/**
 * The app's one player. It lives outside React so playback survives navigation; its audio
 * element is created on the first action, which only ever happens in the browser.
 */
export const player = createPlayer({
  createEngine: (events) => new AudioEngine(createAudioElement(), resolveStream, events),
  env: { rng: Math.random, uid: () => crypto.randomUUID() },
  recordPlay,
  notify: (message) => toast(message),
});

/** Subscribes a component to part of the player state. Wrap object results in `useShallow`. */
export function usePlayer<T>(selector: (state: PlayerState) => T): T {
  return useStore(player.store, selector);
}
```

`apps/web/components/player/player-runtime.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { player } from '@/lib/player/instance';
import { bindMediaSession } from '@/lib/player/media-session';
import { persistPlayer } from '@/lib/player/persistence';

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Restores and saves the player, and connects the OS media controls. Renders nothing. */
export function PlayerRuntime() {
  useEffect(() => {
    const storage = localStorageOrNull();
    const stopSaving = storage ? persistPlayer(player, storage, window) : () => {};
    const stopSession =
      'mediaSession' in navigator
        ? bindMediaSession(player, navigator.mediaSession, (init) => new MediaMetadata(init))
        : () => {};
    return () => {
      stopSaving();
      stopSession();
    };
  }, []);
  return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @riff/web exec vitest run lib/player && pnpm --filter @riff/web typecheck`
Expected: `Tests  91 passed (91)`: 52 from before, plus persistence 9, Media Session 6, shortcuts 21, remote 3. No type errors.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): persist the player, bind Media Session and add keyboard shortcuts"
```

### Task 7: Query hooks with optimistic updates

**Files:**
- Create: `apps/web/lib/query-client.ts`, `apps/web/lib/queries/keys.ts`, `apps/web/lib/queries/catalog.ts`, `apps/web/lib/queries/library.ts`, `apps/web/lib/queries/playlists.ts`, `apps/web/test/api-stub.ts`, `apps/web/test/query-wrapper.tsx`
- Test: `apps/web/lib/queries/catalog.test.tsx`, `apps/web/lib/queries/library.test.tsx`, `apps/web/lib/queries/playlists.test.tsx`

**Interfaces:**
- Consumes: `api`, `unwrap`, `expectOk` and `ApiRequestError` from Task 3; the types `PlaylistDetail` and `PlaylistSummary` from `@riff/api`.
- Produces:
  - `query-client.ts`: `createQueryClient()` (4xx errors are final; server and network errors retry twice; `staleTime` 60 s), `shouldRetry(failureCount, error)`, and `describeError(error): string`.
  - `keys`: every query key. Everything under `['me', …]` is the user's library.
  - `catalog.ts`:
    - `searchText(q)`, `useSearch(q)`, `useTrending(genre | null, window, limit?)`
    - `useArtist(id)`, `useArtistTracks(id)`, `useRelatedArtists(id)`, `useCollection(id)`
    - `useLyrics(trackId | null)`: null on a 404
    - `useRadioTop()`, `useRadioSearch(q)`
  - `library.ts`:
    - `useHome()`, `useMe()`, `useRecentlyPlayed()`, `useLikes()` (infinite, by cursor)
    - `useLikedIds(): ReadonlySet<string>`, `useToggleLike()` (`mutate({ track, like })`)
    - `useFollowing()`, `useToggleFollow()` (`mutate({ artist, follow })`)
  - `playlists.ts`:
    - `afterIdForMove(ids, from, to)`, `moveAfter(entries, entryId, afterEntryId)`
    - `usePlaylists()`, `usePlaylist(id)`
    - `useCreatePlaylist()` (resolves to the new `PlaylistSummary`)
    - `useUpdatePlaylist(id)`, `useDeletePlaylist()`
    - `useAddToPlaylist()` (`mutate({ playlist, trackIds })`, which toasts `Added to <name>`)
    - `useMoveEntry(playlistId)` (`mutate({ entryId, afterEntryId })`), `useRemoveEntry(playlistId)`
  - Every optimistic mutation rolls back on failure and toasts `Couldn’t … <describeError>`.
  - Test helpers:
    - `test/api-stub.ts`: `stubApi(routes)`, which returns `{ requests }`, plus `apiError(status, code, message?)` and `noContent()`.
    - `test/query-wrapper.tsx`: `queryWrapper()`, which returns `{ client, wrapper }` with no retries.

- [ ] **Step 1: Write the test helpers and the failing tests**

`apps/web/test/api-stub.ts`:

```ts
import { vi } from 'vitest';

export interface StubRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Route = ((request: StubRequest) => Response | Promise<Response>) | object | null;

/** A JSON error in the API's contract. */
export const apiError = (status: number, code: string, message = code) =>
  Response.json({ error: { code, message } }, { status });

export const noContent = () => new Response(null, { status: 204 });

/**
 * Replaces `fetch` with a route table keyed by `"METHOD /path"` (query strings ignored).
 * A plain value is returned as JSON. An unmatched request throws, failing the test loudly.
 */
export function stubApi(routes: Record<string, Route>) {
  const requests: StubRequest[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const request: StubRequest = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const key = `${request.method} ${request.path}`;
    if (!(key in routes)) throw new Error(`Unexpected request: ${key}`);
    const route = routes[key];
    return typeof route === 'function' ? route(request) : Response.json(route);
  });
  vi.stubGlobal('fetch', fetch);
  return { requests };
}
```

`apps/web/test/query-wrapper.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** A fresh QueryClient without retries, and a wrapper component that provides it. */
export function queryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
```

`apps/web/lib/queries/catalog.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiError, stubApi } from '@/test/api-stub';
import { queryWrapper } from '@/test/query-wrapper';
import { searchText, useLyrics, useSearch, useTrending } from './catalog';

afterEach(() => vi.unstubAllGlobals());

describe('useSearch', () => {
  test('never sends a blank query', () => {
    const { requests } = stubApi({});
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useSearch('   '), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(requests).toEqual([]);
  });

  test('sends the trimmed, collapsed query', async () => {
    const { requests } = stubApi({
      'GET /api/search': { tracks: [], artists: [], collections: [], stations: [], sources: {} },
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useSearch('  lofi   beats '), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests[0]?.query.get('q')).toBe('lofi beats');
    expect(searchText(' a  b ')).toBe('a b');
  });
});

test('useTrending omits the genre for all genres', async () => {
  const { requests } = stubApi({ 'GET /api/trending': { tracks: [], sources: {} } });
  const { wrapper } = queryWrapper();
  const { result } = renderHook(() => useTrending(null, 'month'), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(requests[0]?.query.has('genre')).toBe(false);
  expect(requests[0]?.query.get('window')).toBe('month');
});

describe('useLyrics', () => {
  test('a 404 means no lyrics, not an error', async () => {
    stubApi({ 'GET /api/tracks/audius:t1/lyrics': () => apiError(404, 'NOT_FOUND') });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useLyrics('audius:t1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  test('other failures are errors', async () => {
    stubApi({ 'GET /api/tracks/audius:t1/lyrics': () => apiError(504, 'UPSTREAM_TIMEOUT') });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useLyrics('audius:t1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  test('does nothing without a track', () => {
    const { requests } = stubApi({});
    const { wrapper } = queryWrapper();
    renderHook(() => useLyrics(null), { wrapper });
    expect(requests).toEqual([]);
  });
});
```

These tests hold requests open (`release()`, `fail()`) to observe the optimistic state, and keep stateful stubs so the refetch after success sees the server's answer. With an instant stub, the optimistic window closes before `waitFor` polls.

`apps/web/lib/queries/library.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiError, noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { queryWrapper } from '@/test/query-wrapper';
import { keys } from './keys';
import { useFollowing, useLikedIds, useLikes, useToggleFollow, useToggleLike } from './library';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const artist = {
  id: 'audius:a1' as const,
  source: 'audius' as const,
  name: 'Kaito',
  avatar: {},
  verified: false,
};

describe('likes', () => {
  test('liking shows the heart at once and keeps it when the server agrees', async () => {
    const liked: string[] = [];
    let release: () => void = () => {};
    const { requests } = stubApi({
      'GET /api/me/likes/ids': () => Response.json(liked),
      'PUT /api/me/likes/audius:t1': () =>
        new Promise<Response>((done) => {
          release = () => {
            liked.push('audius:t1');
            done(noContent());
          };
        }),
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => ({ ids: useLikedIds(), toggle: useToggleLike() }), {
      wrapper,
    });
    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => result.current.toggle.mutate({ track: track(1), like: true }));
    await waitFor(() => expect(result.current.ids.has('audius:t1')).toBe(true));
    release();
    await waitFor(() => expect(result.current.toggle.isSuccess).toBe(true));
    expect(result.current.ids.has('audius:t1')).toBe(true);
  });

  test('a failed like rolls back and says why', async () => {
    stubApi({
      'GET /api/me/likes/ids': [],
      'PUT /api/me/likes/audius:t1': () => apiError(502, 'UPSTREAM_ERROR', 'Audius is down'),
    });
    const { wrapper, client } = queryWrapper();
    client.setQueryData(keys.likeIds, []);
    const { result } = renderHook(() => ({ ids: useLikedIds(), toggle: useToggleLike() }), {
      wrapper,
    });
    act(() => result.current.toggle.mutate({ track: track(1), like: true }));
    await waitFor(() => expect(result.current.toggle.isError).toBe(true));
    expect(result.current.ids.has('audius:t1')).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'Couldn’t like “Track 1”. The music source is having trouble right now.',
    );
  });

  test('pages through liked songs with the cursor', async () => {
    const { requests } = stubApi({
      'GET /api/me/likes': ({ query }) =>
        Response.json(
          query.get('cursor')
            ? { items: [{ track: track(2), likedAt: '2026-01-01T00:00:00Z' }], nextCursor: null }
            : { items: [{ track: track(1), likedAt: '2026-01-02T00:00:00Z' }], nextCursor: 'c1' },
        ),
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useLikes(), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(requests[0]?.query.has('cursor')).toBe(false);
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(requests[1]?.query.get('cursor')).toBe('c1');
    expect(result.current.data?.pages.flatMap((page) => page.items)).toHaveLength(2);
  });
});

describe('following', () => {
  test('unfollowing removes the artist at once and restores it on failure', async () => {
    let fail: () => void = () => {};
    stubApi({
      'GET /api/me/following': [artist],
      'DELETE /api/me/following/audius:a1': () =>
        new Promise<Response>((done) => {
          fail = () => done(apiError(500, 'INTERNAL', 'Something went wrong'));
        }),
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(
      () => ({ following: useFollowing(), toggle: useToggleFollow() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.following.data).toHaveLength(1));
    act(() => result.current.toggle.mutate({ artist, follow: false }));
    await waitFor(() => expect(result.current.following.data).toHaveLength(0));
    fail();
    await waitFor(() => expect(result.current.toggle.isError).toBe(true));
    await waitFor(() => expect(result.current.following.data).toHaveLength(1));
    expect(toast.error).toHaveBeenCalledWith('Couldn’t unfollow Kaito. Something went wrong');
  });
});
```

`apps/web/lib/queries/playlists.test.tsx`:

```tsx
import type { PlaylistDetail } from '@riff/api';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiError, noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { queryWrapper } from '@/test/query-wrapper';
import { keys } from './keys';
import {
  afterIdForMove,
  moveAfter,
  useAddToPlaylist,
  useMoveEntry,
  usePlaylist,
  useRemoveEntry,
} from './playlists';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

function detail(entryIds: string[]): PlaylistDetail {
  return {
    id: PID,
    name: 'Night drive',
    description: null,
    coverUrl: null,
    isPublic: false,
    trackCount: entryIds.length,
    covers: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ownerId: 'u1',
    isOwner: true,
    entries: entryIds.map((id, i) => ({
      id,
      track: track(i + 1),
      addedAt: '2026-09-01T00:00:00Z',
    })),
  };
}

const entryIds = (playlist: PlaylistDetail | undefined) => playlist?.entries.map((e) => e.id);

describe('reorder helpers', () => {
  const ids = ['a', 'b', 'c', 'd'];

  test.each([
    [0, 2, 'c'],
    [3, 0, null],
    [3, 1, 'a'],
    [1, 3, 'd'],
    [2, 2, 'b'],
  ])('moving index %i to %i follows %j', (from, to, expected) => {
    expect(afterIdForMove(ids, from, to)).toBe(expected);
  });

  test('moveAfter agrees with afterIdForMove', () => {
    const entries = ids.map((id) => ({ id }));
    for (let from = 0; from < ids.length; from++) {
      for (let to = 0; to < ids.length; to++) {
        const expected = ids.slice();
        const [moved] = expected.splice(from, 1);
        expected.splice(to, 0, moved as string);
        const after = afterIdForMove(ids, from, to);
        expect(moveAfter(entries, ids[from] as string, after).map((e) => e.id)).toEqual(expected);
      }
    }
  });
});

describe('playlist edits', () => {
  test('a reorder shows at once and sends the new neighbour', async () => {
    let order = ['e1', 'e2', 'e3'];
    let release: () => void = () => {};
    const { requests } = stubApi({
      [`GET /api/playlists/${PID}`]: () => Response.json(detail(order)),
      [`PATCH /api/me/playlists/${PID}/tracks/e3`]: () =>
        new Promise<Response>((done) => {
          release = () => {
            order = ['e3', 'e1', 'e2'];
            done(noContent());
          };
        }),
    });
    const { wrapper, client } = queryWrapper();
    const { result } = renderHook(() => ({ playlist: usePlaylist(PID), move: useMoveEntry(PID) }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.playlist.isSuccess).toBe(true));
    act(() => result.current.move.mutate({ entryId: 'e3', afterEntryId: null }));
    await waitFor(() =>
      expect(entryIds(client.getQueryData(keys.playlist(PID)))).toEqual(['e3', 'e1', 'e2']),
    );
    release();
    await waitFor(() => expect(result.current.move.isSuccess).toBe(true));
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ afterEntryId: null });
  });

  test('a failed reorder snaps back and says so', async () => {
    stubApi({
      [`GET /api/playlists/${PID}`]: () => Response.json(detail(['e1', 'e2'])),
      [`PATCH /api/me/playlists/${PID}/tracks/e2`]: () => apiError(404, 'NOT_FOUND', 'Gone'),
    });
    const { wrapper, client } = queryWrapper();
    const { result } = renderHook(() => ({ playlist: usePlaylist(PID), move: useMoveEntry(PID) }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.playlist.isSuccess).toBe(true));
    act(() => result.current.move.mutate({ entryId: 'e2', afterEntryId: null }));
    await waitFor(() => expect(result.current.move.isError).toBe(true));
    expect(entryIds(client.getQueryData(keys.playlist(PID)))).toEqual(['e1', 'e2']);
    expect(toast.error).toHaveBeenCalledWith(
      'Couldn’t move the track. This page doesn’t exist, or was removed.',
    );
  });

  test('removing an entry drops only that entry (duplicates stay)', async () => {
    stubApi({
      [`GET /api/playlists/${PID}`]: () => Response.json(detail(['e1', 'e2'])),
      [`DELETE /api/me/playlists/${PID}/tracks/e1`]: () => new Promise<Response>(() => {}),
    });
    const { wrapper, client } = queryWrapper();
    const { result } = renderHook(
      () => ({ playlist: usePlaylist(PID), remove: useRemoveEntry(PID) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.playlist.isSuccess).toBe(true));
    act(() => result.current.remove.mutate('e1'));
    await waitFor(() => expect(entryIds(client.getQueryData(keys.playlist(PID)))).toEqual(['e2']));
    expect(client.getQueryData<PlaylistDetail>(keys.playlist(PID))?.trackCount).toBe(1);
  });

  test('adding tracks confirms with a toast naming the playlist', async () => {
    const { requests } = stubApi({
      [`POST /api/me/playlists/${PID}/tracks`]: () =>
        Response.json({ entries: [] }, { status: 201 }),
      'GET /api/me/playlists': [],
    });
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => useAddToPlaylist(), { wrapper });
    act(() => result.current.mutate({ playlist: detail([]), trackIds: [track(1).id] }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests[0]?.body).toEqual({ trackIds: ['audius:t1'] });
    expect(toast).toHaveBeenCalledWith('Added to Night drive');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run lib/queries`
Expected: all three FAIL with `Failed to resolve import` (`./catalog`, `./keys`, `./playlists`).

- [ ] **Step 3: Write the query client, the keys and the hooks**

`apps/web/lib/query-client.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './api';

/** Client errors (4xx) are final; server and network errors get two more tries. */
export const shouldRetry = (failureCount: number, error: unknown): boolean =>
  !(error instanceof ApiRequestError && error.status < 500) && failureCount < 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: shouldRetry, refetchOnWindowFocus: false },
    },
  });
}

/** A short, user-facing description of a failed request. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'UPSTREAM_TIMEOUT') return 'The music source took too long to answer.';
    if (error.code === 'UPSTREAM_ERROR') return 'The music source is having trouble right now.';
    if (error.code === 'NOT_FOUND') return 'This page doesn’t exist, or was removed.';
    return error.message;
  }
  return 'Could not reach Riff. Check your connection.';
}
```

`apps/web/lib/queries/keys.ts`:

```ts
import type { TrendingWindow } from '@riff/core';

/** Query keys. Everything under `me` is the signed-in user's library. */
export const keys = {
  home: ['home'] as const,
  search: (q: string) => ['search', q] as const,
  trending: (genre: string | null, window: TrendingWindow) => ['trending', genre, window] as const,
  lyrics: (trackId: string) => ['lyrics', trackId] as const,
  artist: (id: string) => ['artist', id] as const,
  artistTracks: (id: string) => ['artist', id, 'tracks'] as const,
  relatedArtists: (id: string) => ['artist', id, 'related'] as const,
  collection: (id: string) => ['collection', id] as const,
  radioTop: ['radio', 'top'] as const,
  radioSearch: (q: string) => ['radio', 'search', q] as const,
  playlist: (id: string) => ['playlist', id] as const,
  me: ['me'] as const,
  likes: ['me', 'likes', 'pages'] as const,
  likeIds: ['me', 'likes', 'ids'] as const,
  playlists: ['me', 'playlists'] as const,
  following: ['me', 'following'] as const,
  recent: ['me', 'recent'] as const,
};
```

`apps/web/lib/queries/catalog.ts`:

```ts
import type { Lyrics, TrendingWindow } from '@riff/core';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError, api, unwrap } from '@/lib/api';
import { keys } from './keys';

/** Normalises what the user typed; blank queries are never sent (the API rejects them). */
export const searchText = (q: string): string => q.trim().replace(/\s+/g, ' ');

export function useSearch(q: string) {
  const text = searchText(q);
  return useQuery({
    queryKey: keys.search(text),
    queryFn: () => unwrap(api.search.$get({ query: { q: text, limit: '20' } })),
    enabled: text.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useTrending(genre: string | null, window: TrendingWindow, limit = 50) {
  return useQuery({
    queryKey: keys.trending(genre, window),
    queryFn: () =>
      unwrap(
        api.trending.$get({ query: { genre: genre ?? undefined, window, limit: String(limit) } }),
      ),
  });
}

export function useArtist(id: string) {
  return useQuery({
    queryKey: keys.artist(id),
    queryFn: () => unwrap(api.artists[':id'].$get({ param: { id } })),
  });
}

export function useArtistTracks(id: string) {
  return useQuery({
    queryKey: keys.artistTracks(id),
    queryFn: () =>
      unwrap(api.artists[':id'].tracks.$get({ param: { id }, query: { limit: '20' } })),
  });
}

export function useRelatedArtists(id: string) {
  return useQuery({
    queryKey: keys.relatedArtists(id),
    queryFn: () =>
      unwrap(api.artists[':id'].related.$get({ param: { id }, query: { limit: '12' } })),
  });
}

export function useCollection(id: string) {
  return useQuery({
    queryKey: keys.collection(id),
    queryFn: () => unwrap(api.collections[':id'].$get({ param: { id } })),
  });
}

/** null when LRCLIB has no lyrics for the track (a 404 is an answer, not an error). */
export function useLyrics(trackId: string | null) {
  return useQuery({
    queryKey: keys.lyrics(trackId ?? ''),
    queryFn: async (): Promise<Lyrics | null> => {
      try {
        return await unwrap(api.tracks[':id'].lyrics.$get({ param: { id: trackId as string } }));
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: trackId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRadioTop() {
  return useQuery({
    queryKey: keys.radioTop,
    queryFn: () => unwrap(api.radio.top.$get({ query: { limit: '40' } })),
  });
}

export function useRadioSearch(q: string) {
  const text = searchText(q);
  return useQuery({
    queryKey: keys.radioSearch(text),
    queryFn: () => unwrap(api.radio.search.$get({ query: { q: text, limit: '40' } })),
    enabled: text.length > 0,
    placeholderData: (previous) => previous,
  });
}
```

`apps/web/lib/queries/library.ts`:

```ts
import type { Artist, EntityId, Track } from '@riff/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, expectOk, unwrap } from '@/lib/api';
import { describeError } from '@/lib/query-client';
import { keys } from './keys';

export function useHome() {
  return useQuery({ queryKey: keys.home, queryFn: () => unwrap(api.home.$get()) });
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => unwrap(api.me.$get()),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRecentlyPlayed() {
  return useQuery({
    queryKey: keys.recent,
    queryFn: () => unwrap(api.me.history.recent.$get({ query: { limit: '20' } })),
  });
}

/** Liked songs, newest first, 50 per page. */
export function useLikes() {
  return useInfiniteQuery({
    queryKey: keys.likes,
    queryFn: ({ pageParam }) => unwrap(api.me.likes.$get({ query: { cursor: pageParam } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Every liked track id, for heart buttons. */
export function useLikedIds(): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: keys.likeIds,
    queryFn: () => unwrap(api.me.likes.ids.$get()),
    select: (ids) => new Set<string>(ids),
    staleTime: 5 * 60_000,
  });
  return data ?? EMPTY_IDS;
}

/** Likes or unlikes a track, updating hearts at once and rolling back with a toast on failure. */
export function useToggleLike() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ track, like }: { track: Track; like: boolean }) => {
      const param = { param: { trackId: track.id } };
      return expectOk(
        like ? api.me.likes[':trackId'].$put(param) : api.me.likes[':trackId'].$delete(param),
      );
    },
    onMutate: async ({ track, like }) => {
      await client.cancelQueries({ queryKey: keys.likeIds });
      const previous = client.getQueryData<EntityId[]>(keys.likeIds);
      client.setQueryData<EntityId[]>(keys.likeIds, (ids = []) =>
        like
          ? [track.id, ...ids.filter((id) => id !== track.id)]
          : ids.filter((id) => id !== track.id),
      );
      return { previous };
    },
    onError: (error, { track, like }, context) => {
      client.setQueryData(keys.likeIds, context?.previous);
      toast.error(`Couldn’t ${like ? 'like' : 'unlike'} “${track.title}”. ${describeError(error)}`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.likeIds });
      void client.invalidateQueries({ queryKey: keys.likes });
    },
  });
}

export function useFollowing() {
  return useQuery({ queryKey: keys.following, queryFn: () => unwrap(api.me.following.$get()) });
}

/** Follows or unfollows an artist optimistically; rolls back with a toast on failure. */
export function useToggleFollow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ artist, follow }: { artist: Artist; follow: boolean }) => {
      const param = { param: { artistId: artist.id } };
      return expectOk(
        follow
          ? api.me.following[':artistId'].$put(param)
          : api.me.following[':artistId'].$delete(param),
      );
    },
    onMutate: async ({ artist, follow }) => {
      await client.cancelQueries({ queryKey: keys.following });
      const previous = client.getQueryData<Artist[]>(keys.following);
      client.setQueryData<Artist[]>(keys.following, (artists = []) => {
        const others = artists.filter((a) => a.id !== artist.id);
        return follow ? [artist, ...others] : others;
      });
      return { previous };
    },
    onError: (error, { artist, follow }, context) => {
      client.setQueryData(keys.following, context?.previous);
      toast.error(
        `Couldn’t ${follow ? 'follow' : 'unfollow'} ${artist.name}. ${describeError(error)}`,
      );
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.following });
      void client.invalidateQueries({ queryKey: keys.home });
    },
  });
}
```

`apps/web/lib/queries/playlists.ts`:

```ts
import type { PlaylistDetail, PlaylistSummary } from '@riff/api';
import type { EntityId } from '@riff/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, expectOk, unwrap } from '@/lib/api';
import { describeError } from '@/lib/query-client';
import { keys } from './keys';

/** The entry a moved entry ends up after, when dragged from index `from` to `to` (null: first). */
export function afterIdForMove(ids: readonly string[], from: number, to: number): string | null {
  const rest = ids.filter((_, index) => index !== from);
  return to <= 0 ? null : (rest[Math.min(to, rest.length) - 1] ?? null);
}

/** `entries` with `entryId` moved right after `afterEntryId` (or to the top for null). */
export function moveAfter<T extends { id: string }>(
  entries: readonly T[],
  entryId: string,
  afterEntryId: string | null,
): T[] {
  const moved = entries.find((entry) => entry.id === entryId);
  if (!moved) return entries.slice();
  const rest = entries.filter((entry) => entry.id !== entryId);
  const at = afterEntryId === null ? 0 : rest.findIndex((entry) => entry.id === afterEntryId) + 1;
  rest.splice(at, 0, moved);
  return rest;
}

export function usePlaylists() {
  return useQuery({ queryKey: keys.playlists, queryFn: () => unwrap(api.me.playlists.$get()) });
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: keys.playlist(id),
    queryFn: () => unwrap(api.playlists[':id'].$get({ param: { id } })),
  });
}

export function useCreatePlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      unwrap(api.me.playlists.$post({ json: input })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.playlists }),
    onError: (error) => toast.error(`Couldn’t create the playlist. ${describeError(error)}`),
  });
}

export interface PlaylistPatch {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
}

export function useUpdatePlaylist(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: PlaylistPatch) =>
      unwrap(api.me.playlists[':id'].$patch({ param: { id }, json: patch })),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: keys.playlist(id) });
      const previous = client.getQueryData<PlaylistDetail>(keys.playlist(id));
      client.setQueryData<PlaylistDetail>(keys.playlist(id), (playlist) =>
        playlist ? { ...playlist, ...patch } : playlist,
      );
      return { previous };
    },
    onError: (error, _patch, context) => {
      client.setQueryData(keys.playlist(id), context?.previous);
      toast.error(`Couldn’t save the playlist. ${describeError(error)}`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.playlist(id) });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useDeletePlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expectOk(api.me.playlists[':id'].$delete({ param: { id } })),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: keys.playlists });
      const previous = client.getQueryData<PlaylistSummary[]>(keys.playlists);
      client.setQueryData<PlaylistSummary[]>(keys.playlists, (list) =>
        list?.filter((playlist) => playlist.id !== id),
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      client.setQueryData(keys.playlists, context?.previous);
      toast.error(`Couldn’t delete the playlist. ${describeError(error)}`);
    },
    onSuccess: (_result, id) => client.removeQueries({ queryKey: keys.playlist(id) }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.playlists }),
  });
}

export function useAddToPlaylist() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ playlist, trackIds }: { playlist: PlaylistSummary; trackIds: EntityId[] }) =>
      unwrap(
        api.me.playlists[':id'].tracks.$post({ param: { id: playlist.id }, json: { trackIds } }),
      ),
    onSuccess: (_result, { playlist, trackIds }) => {
      toast(
        trackIds.length === 1
          ? `Added to ${playlist.name}`
          : `Added ${trackIds.length} tracks to ${playlist.name}`,
      );
    },
    onError: (error, { playlist }) =>
      toast.error(`Couldn’t add to ${playlist.name}. ${describeError(error)}`),
    onSettled: (_result, _error, { playlist }) => {
      void client.invalidateQueries({ queryKey: keys.playlist(playlist.id) });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useMoveEntry(playlistId: string) {
  const client = useQueryClient();
  const key = keys.playlist(playlistId);
  return useMutation({
    mutationFn: ({ entryId, afterEntryId }: { entryId: string; afterEntryId: string | null }) =>
      expectOk(
        api.me.playlists[':id'].tracks[':entryId'].$patch({
          param: { id: playlistId, entryId },
          json: { afterEntryId },
        }),
      ),
    onMutate: async ({ entryId, afterEntryId }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PlaylistDetail>(key);
      client.setQueryData<PlaylistDetail>(key, (playlist) =>
        playlist
          ? { ...playlist, entries: moveAfter(playlist.entries, entryId, afterEntryId) }
          : playlist,
      );
      return { previous };
    },
    onError: (error, _move, context) => {
      client.setQueryData(key, context?.previous);
      toast.error(`Couldn’t move the track. ${describeError(error)}`);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useRemoveEntry(playlistId: string) {
  const client = useQueryClient();
  const key = keys.playlist(playlistId);
  return useMutation({
    mutationFn: (entryId: string) =>
      expectOk(
        api.me.playlists[':id'].tracks[':entryId'].$delete({ param: { id: playlistId, entryId } }),
      ),
    onMutate: async (entryId) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PlaylistDetail>(key);
      client.setQueryData<PlaylistDetail>(key, (playlist) =>
        playlist
          ? {
              ...playlist,
              trackCount: playlist.trackCount - 1,
              entries: playlist.entries.filter((entry) => entry.id !== entryId),
            }
          : playlist,
      );
      return { previous };
    },
    onError: (error, _entryId, context) => {
      client.setQueryData(key, context?.previous);
      toast.error(`Couldn’t remove the track. ${describeError(error)}`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @riff/web exec vitest run lib/queries && pnpm --filter @riff/web typecheck`
Expected: `Tests  20 passed (20)`: catalog 6, library 4, playlists 10. No type errors.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add query hooks with optimistic likes, follows and playlist edits"
```

### Task 8: UI primitives and the player controls

**Files:**
- Create: `apps/web/components/ui/{slider,menu,dialog,sheet,tabs,skeleton}.tsx`, `apps/web/lib/format.ts`, `apps/web/components/media/artwork.tsx`, `apps/web/components/tracks/like-button.tsx`, `apps/web/components/player/{transport,seek-bar,volume-control,now-playing-info}.tsx`, `apps/web/test/player-mock.ts`
- Test: `apps/web/lib/format.test.ts`, `apps/web/components/player/controls.test.tsx`, `apps/web/components/media/media.test.tsx`

**Interfaces:**
- Consumes: `player` and `usePlayer` from Task 6; `useLikedIds` and `useToggleLike` from Task 7; `Button` and `cn` from Task 3.
- Produces:
  - Primitives:
    - `<Slider label valueText? …RadixSliderProps>`: the thumb carries the accessible name.
    - `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuSub`, `MenuSubTrigger`, `MenuSubContent`, `MenuSeparator`, `MenuLabel`, and their `ContextMenu*` twins.
    - `Dialog`, `DialogTrigger`, `DialogClose`, and `<DialogContent title description?>`.
    - `Sheet`, `SheetContent`, `SheetTitle`, `SheetDescription`, `SheetClose`.
    - `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, and `<Skeleton className>`.
  - `format.ts`: `formatDuration(sec)`, `formatCount(n)`, `artistNames(artists)`.
  - `artwork.tsx`: `pickArtwork(artwork, 'sm'|'md'|'lg')`, and `<Artwork artwork size className alt?>`, which shows a placeholder when there's no image or it fails to load.
  - `<LikeButton track className?>`: renders nothing for live stations.
  - `<PlayButton large? className?>` and `<Transport large?>`.
  - `<SeekBar className?>` and `<LiveBadge className?>`.
  - `<VolumeControl>` and `<NowPlayingInfo>`.
  - `test/player-mock.ts`: a module that stands in for `@/lib/player/instance` (a real player over `FakeMedia`). Use it as `vi.mock('@/lib/player/instance', () => import('@/test/player-mock'))`.

- [ ] **Step 1: Write the player mock and the failing tests**

`apps/web/test/player-mock.ts`:

```ts
/**
 * Stand-in for `@/lib/player/instance` in component tests:
 *   vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
 * The player is real; only the media element and the network are fake.
 */
import { useStore } from 'zustand';
import type { PlayerState } from '@/lib/player/player';
import { createTestPlayer } from './test-player';

const testPlayer = createTestPlayer();

export const player = testPlayer.player;
export const media = testPlayer.media;

export function usePlayer<T>(selector: (state: PlayerState) => T): T {
  return useStore(player.store, selector);
}
```

`apps/web/lib/format.test.ts`:

```ts
import { expect, test } from 'vitest';
import { artistNames, formatCount, formatDuration } from './format';

test.each([
  [0, '0:00'],
  [7.9, '0:07'],
  [205, '3:25'],
  [3729, '1:02:09'],
  [null, '0:00'],
  [Number.NaN, '0:00'],
  [Number.POSITIVE_INFINITY, '0:00'],
  [-4, '0:00'],
])('formatDuration(%s) is %s', (input, expected) => {
  expect(formatDuration(input)).toBe(expected);
});

test('formatCount is compact', () => {
  expect(formatCount(950)).toBe('950');
  expect(formatCount(1234)).toBe('1.2K');
  expect(formatCount(3_400_000)).toBe('3.4M');
});

test('artistNames joins names', () => {
  expect(artistNames([{ name: 'A' }, { name: 'B' }])).toBe('A, B');
  expect(artistNames([])).toBe('');
});
```

`apps/web/components/player/controls.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { station, track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { SeekBar } from './seek-bar';
import { Transport } from './transport';
import { VolumeControl } from './volume-control';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Mix' };

beforeEach(() => {
  player.actions.reset();
  player.store.setState({ volume: 1, muted: false });
});

afterEach(() => vi.restoreAllMocks());

describe('Transport', () => {
  test('is disabled until something is loaded', () => {
    render(<Transport />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('play/pause follows the player status', async () => {
    act(() => player.actions.playContext(tracks(2), 0, ctx));
    act(() => player.store.setState({ status: 'playing' }));
    render(<Transport />);
    const toggle = vi.spyOn(player.actions, 'togglePlay');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  test('previous is disabled for live stations', () => {
    act(() => player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' }));
    render(<Transport />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('shuffle and repeat show their state', async () => {
    render(<Transport />);
    const shuffle = screen.getByRole('button', { name: 'Shuffle' });
    await userEvent.click(shuffle);
    expect(shuffle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Repeat all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Repeat one' }));
    expect(screen.getByRole('button', { name: 'Turn repeat off' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('SeekBar', () => {
  test('shows elapsed and total time and seeks with the keyboard', () => {
    act(() => player.actions.playContext([track(1)], 0, ctx));
    act(() => player.store.setState({ position: 65, duration: 200 }));
    render(<SeekBar />);
    const thumb = screen.getByRole('slider', { name: 'Seek' });
    expect(thumb).toHaveAttribute('aria-valuetext', '1:05 of 3:20');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(player.store.getState().position).toBe(66);
  });

  test('shows LIVE instead of a bar for stations', () => {
    act(() => player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' }));
    render(<SeekBar />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});

describe('VolumeControl', () => {
  test('mutes, unmutes and adjusts', async () => {
    render(<VolumeControl />);
    await userEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(player.store.getState().muted).toBe(true);
    const thumb = screen.getByRole('slider', { name: 'Volume' });
    expect(thumb).toHaveAttribute('aria-valuetext', '0%');
    await userEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Volume' }), { key: 'ArrowLeft' });
    expect(player.store.getState().volume).toBeCloseTo(0.99);
  });
});
```

`apps/web/components/media/media.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LikeButton } from '@/components/tracks/like-button';
import { noContent, stubApi } from '@/test/api-stub';
import { station, track } from '@/test/fixtures';
import { queryWrapper } from '@/test/query-wrapper';
import { Artwork, pickArtwork } from './artwork';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

describe('Artwork', () => {
  test('picks the nearest available size', () => {
    expect(pickArtwork({ md: 'm', lg: 'l' }, 'sm')).toBe('m');
    expect(pickArtwork({ sm: 's' }, 'lg')).toBe('s');
    expect(pickArtwork({}, 'md')).toBeUndefined();
  });

  test('falls back to a placeholder when the image fails', () => {
    const { container } = render(<Artwork artwork={{ md: 'https://img.test/x.jpg' }} size="md" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('LikeButton', () => {
  test('reflects and toggles the liked state', async () => {
    const liked = ['audius:t1'];
    stubApi({
      'GET /api/me/likes/ids': () => Response.json(liked),
      'DELETE /api/me/likes/audius:t1': () => {
        liked.pop();
        return noContent();
      },
    });
    const { wrapper } = queryWrapper();
    render(<LikeButton track={track(1)} />, { wrapper });
    const button = await screen.findByRole('button', {
      name: 'Remove Track 1 from Liked Songs',
    });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(
      await screen.findByRole('button', { name: 'Save Track 1 to Liked Songs' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('is absent for live stations', () => {
    stubApi({ 'GET /api/me/likes/ids': [] });
    const { wrapper } = queryWrapper();
    render(<LikeButton track={station(1)} />, { wrapper });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run lib/format components`
Expected: `format.test.ts`, `controls.test.tsx` and `media.test.tsx` FAIL with `Failed to resolve import`.

- [ ] **Step 3: Write the primitives**

These are shadcn-style wrappers over the unified `radix-ui` package, styled with the tokens from Task 2.

`apps/web/components/ui/slider.tsx`:

```tsx
'use client';

import { Slider as SliderPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** Accessible name of the thumb (the element with role="slider"). */
  label: string;
  /** Spoken value, e.g. "1:05 of 3:20". */
  valueText?: string;
}

/** A single-thumb slider: the filled range turns ember on hover and focus. */
export function Slider({ className, label, valueText, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn(
        'group relative flex h-4 w-full cursor-pointer touch-none select-none items-center data-disabled:cursor-default data-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-fg transition-colors group-hover:bg-accent group-has-focus-visible:bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className="block size-3 rounded-full bg-fg opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent"
      />
    </SliderPrimitive.Root>
  );
}
```

`apps/web/components/ui/menu.tsx`:

```tsx
'use client';

import { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const content =
  'z-50 min-w-48 overflow-hidden rounded-xl border border-line bg-raised p-1 text-sm shadow-xl shadow-black/40 motion-safe:animate-pop-in';
const item =
  'relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-fg outline-none data-disabled:pointer-events-none data-highlighted:bg-line data-disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuSub = DropdownMenu.Sub;

export function MenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content sideOffset={sideOffset} className={cn(content, className)} {...props} />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={cn(item, className)} {...props} />;
}

export function MenuSubTrigger({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.SubTrigger>) {
  return (
    <DropdownMenu.SubTrigger
      className={cn(item, 'data-[state=open]:bg-line', className)}
      {...props}
    />
  );
}

export function MenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.SubContent>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        className={cn(content, 'max-h-72 overflow-y-auto', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label className={cn('px-2.5 py-2 text-muted text-xs', className)} {...props} />
  );
}

export const ContextMenuRoot = ContextMenu.Root;
export const ContextMenuTrigger = ContextMenu.Trigger;
export const ContextMenuSub = ContextMenu.Sub;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.Content>) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className={cn(content, className)} {...props} />
    </ContextMenu.Portal>
  );
}

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof ContextMenu.Item>) {
  return <ContextMenu.Item className={cn(item, className)} {...props} />;
}

export function ContextMenuSubTrigger({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.SubTrigger>) {
  return (
    <ContextMenu.SubTrigger
      className={cn(item, 'data-[state=open]:bg-line', className)}
      {...props}
    />
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.SubContent>) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.SubContent
        className={cn(content, 'max-h-72 overflow-y-auto', className)}
        {...props}
      />
    </ContextMenu.Portal>
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenu.Separator>) {
  return <ContextMenu.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}
```

`apps/web/components/ui/dialog.tsx`:

```tsx
'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/50 outline-none',
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-1.5">
          <DialogPrimitive.Title className="font-semibold text-lg">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-muted text-sm">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
```

`apps/web/components/ui/sheet.tsx`:

```tsx
'use client';

import { Dialog } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Sheet = Dialog.Root;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;
export const SheetClose = Dialog.Close;

/** A full-screen dialog (the phone Now Playing view). */
export function SheetContent({ className, ...props }: ComponentProps<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <Dialog.Content
        className={cn(
          'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg outline-none motion-safe:animate-sheet-in',
          className,
        )}
        {...props}
      />
    </Dialog.Portal>
  );
}
```

`apps/web/components/ui/tabs.tsx`:

```tsx
'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex items-center gap-1', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'h-8 rounded-full px-3 font-medium text-muted text-sm transition-colors hover:text-fg data-[state=active]:bg-fg data-[state=active]:text-bg',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
```

`apps/web/components/ui/skeleton.tsx`:

```tsx
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-raised', className)} />;
}
```

- [ ] **Step 4: Write the formatting helpers, artwork and like button**

`apps/web/lib/format.ts`:

```ts
/** 0:07, 3:25, 1:02:09. Unknown or negative values show as 0:00. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const seconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds as number))
    : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 950, 1.2K, 3.4M. */
export const formatCount = (value: number): string => compact.format(value);

/** "Artist A, Artist B" (radio stations have no artists). */
export const artistNames = (artists: readonly { name: string }[]): string =>
  artists.map((artist) => artist.name).join(', ');
```

`apps/web/components/media/artwork.tsx`:

```tsx
'use client';

import type { Artwork as ArtworkSizes } from '@riff/core';
import { Music } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg';

const PREFERENCE: Record<Size, (keyof ArtworkSizes)[]> = {
  sm: ['sm', 'md', 'lg'],
  md: ['md', 'lg', 'sm'],
  lg: ['lg', 'md', 'sm'],
};

/** The best available image for a display size (~150 / ~480 / ~1000 px). */
export function pickArtwork(artwork: ArtworkSizes, size: Size): string | undefined {
  for (const key of PREFERENCE[size]) if (artwork[key]) return artwork[key];
  return undefined;
}

interface ArtworkProps {
  artwork: ArtworkSizes;
  size: Size;
  className?: string;
  /** Artwork is decorative next to a title, so alt is empty unless given. */
  alt?: string;
}

/** Square cover art with a quiet placeholder when there is none (or it fails to load). */
export function Artwork({ artwork, size, className, alt = '' }: ArtworkProps) {
  const src = pickArtwork(artwork, size);
  return <ArtworkImage key={src ?? 'none'} src={src} className={className} alt={alt} />;
}

function ArtworkImage({ src, className, alt }: { src?: string; className?: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const placeholder = cn('grid aspect-square place-items-center bg-raised text-faint', className);
    const icon = <Music className="size-1/3" aria-hidden />;
    return alt ? (
      <div role="img" aria-label={alt} className={placeholder}>
        {icon}
      </div>
    ) : (
      <div className={placeholder}>{icon}</div>
    );
  }
  // A plain <img>: artwork comes from many upstream hosts that next/image would need allowlisted.
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('aspect-square bg-raised object-cover', className)}
    />
  );
}
```

`apps/web/components/tracks/like-button.tsx`:

```tsx
'use client';

import type { Track } from '@riff/core';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLikedIds, useToggleLike } from '@/lib/queries/library';

/** Heart toggle for Liked Songs. Live stations can't be liked, so they get none. */
export function LikeButton({ track, className }: { track: Track; className?: string }) {
  const liked = useLikedIds().has(track.id);
  const toggle = useToggleLike();
  if (track.isLive) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(liked && 'text-accent hover:text-accent', className)}
      aria-label={
        liked ? `Remove ${track.title} from Liked Songs` : `Save ${track.title} to Liked Songs`
      }
      aria-pressed={liked}
      onClick={(event) => {
        event.stopPropagation();
        toggle.mutate({ track, like: !liked });
      }}
    >
      <Heart className={cn(liked && 'fill-current')} />
    </Button>
  );
}
```

- [ ] **Step 5: Write the player controls**

Each control selects plain values with `useShallow`. A selector that builds a new object or array on every read re-renders forever.

`apps/web/components/player/transport.tsx`:

```tsx
'use client';

import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { player, usePlayer } from '@/lib/player/instance';

const REPEAT_LABELS = {
  off: 'Repeat all',
  all: 'Repeat one',
  one: 'Turn repeat off',
} as const;

export function PlayButton({ className, large = false }: { className?: string; large?: boolean }) {
  const { status, hasCurrent } = usePlayer(
    useShallow((s) => ({ status: s.status, hasCurrent: s.queue.current !== null })),
  );
  const active = status === 'playing' || status === 'loading';
  return (
    <Button
      variant="primary"
      size="icon"
      className={cn(
        large ? 'size-16 [&_svg]:size-7' : 'size-10',
        'bg-fg hover:bg-fg/90',
        className,
      )}
      aria-label={active ? 'Pause' : 'Play'}
      disabled={!hasCurrent}
      onClick={() => player.actions.togglePlay()}
    >
      {status === 'loading' ? (
        <Loader2 className="motion-safe:animate-spin" />
      ) : active ? (
        <Pause className="fill-current" />
      ) : (
        <Play className="translate-x-px fill-current" />
      )}
    </Button>
  );
}

/** Shuffle, previous, play/pause, next and repeat. */
export function Transport({ large = false }: { large?: boolean }) {
  const { shuffle, repeat, hasCurrent, live } = usePlayer(
    useShallow((s) => ({
      shuffle: s.queue.shuffle,
      repeat: s.queue.repeat,
      hasCurrent: s.queue.current !== null,
      live: s.queue.current?.track.isLive ?? false,
    })),
  );
  const iconSize = large ? 'size-12 [&_svg]:size-6' : undefined;
  return (
    <div className={cn('flex items-center justify-center', large ? 'gap-4' : 'gap-2')}>
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconSize, shuffle && 'text-accent hover:text-accent')}
        aria-label="Shuffle"
        aria-pressed={shuffle}
        onClick={() => player.actions.toggleShuffle()}
      >
        <Shuffle />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={iconSize}
        aria-label="Previous"
        disabled={!hasCurrent || live}
        onClick={() => player.actions.prev()}
      >
        <SkipBack className="fill-current" />
      </Button>
      <PlayButton large={large} />
      <Button
        variant="ghost"
        size="icon"
        className={iconSize}
        aria-label="Next"
        disabled={!hasCurrent}
        onClick={() => player.actions.next()}
      >
        <SkipForward className="fill-current" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconSize, repeat !== 'off' && 'text-accent hover:text-accent')}
        aria-label={REPEAT_LABELS[repeat]}
        aria-pressed={repeat !== 'off'}
        onClick={() => player.actions.cycleRepeat()}
      >
        {repeat === 'one' ? <Repeat1 /> : <Repeat />}
      </Button>
    </div>
  );
}
```

`apps/web/components/player/seek-bar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';

export function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-[11px] text-accent tracking-wide',
        className,
      )}
    >
      LIVE
    </span>
  );
}

/**
 * Elapsed time, a draggable bar and the duration. Dragging previews the position and seeks
 * on release; arrow keys move 1 s (10 s with Page Up/Down). Live streams show a badge.
 */
export function SeekBar({ className }: { className?: string }) {
  const { position, duration, live, hasCurrent } = usePlayer(
    useShallow((s) => ({
      position: s.position,
      duration: s.duration,
      live: s.queue.current?.track.isLive ?? false,
      hasCurrent: s.queue.current !== null,
    })),
  );
  const [dragging, setDragging] = useState<number | null>(null);

  if (live) {
    return (
      <div className={cn('flex h-4 w-full items-center justify-center', className)}>
        <LiveBadge />
      </div>
    );
  }

  const max = duration ?? 0;
  const value = dragging ?? Math.min(position, max);
  return (
    <div
      className={cn('flex w-full items-center gap-2 text-faint text-xs tabular-nums', className)}
    >
      <span className="w-10 shrink-0 text-right">{formatDuration(value)}</span>
      <Slider
        label="Seek"
        valueText={`${formatDuration(value)} of ${formatDuration(max)}`}
        value={[value]}
        max={Math.max(max, 1)}
        step={1}
        disabled={!hasCurrent || max === 0}
        onValueChange={([next]) => setDragging(next ?? null)}
        onValueCommit={([next]) => {
          if (next !== undefined) player.actions.seek(next);
          setDragging(null);
        }}
      />
      <span className="w-10 shrink-0">{formatDuration(max)}</span>
    </div>
  );
}
```

`apps/web/components/player/volume-control.tsx`:

```tsx
'use client';

import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { player, usePlayer } from '@/lib/player/instance';

export function VolumeControl() {
  const { volume, muted } = usePlayer(useShallow((s) => ({ volume: s.volume, muted: s.muted })));
  const level = muted ? 0 : volume;
  const percent = Math.round(level * 100);
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={() => player.actions.toggleMute()}
      >
        {level === 0 ? <VolumeX /> : level < 0.5 ? <Volume1 /> : <Volume2 />}
      </Button>
      <Slider
        className="w-24"
        label="Volume"
        valueText={`${percent}%`}
        value={[percent]}
        max={100}
        step={1}
        onValueChange={([next]) => player.actions.setVolume((next ?? 0) / 100)}
      />
    </div>
  );
}
```

`apps/web/components/player/now-playing-info.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Artwork } from '@/components/media/artwork';
import { LikeButton } from '@/components/tracks/like-button';
import { usePlayer } from '@/lib/player/instance';

/** Artwork, title, linked artists and the like button for the current track. */
export function NowPlayingInfo() {
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  if (!track) {
    return <p className="truncate text-faint text-sm">Pick something to play</p>;
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Artwork artwork={track.artwork} size="sm" className="size-14 shrink-0 rounded-md" />
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">{track.title}</p>
        <p className="truncate text-muted text-xs">
          {track.artists.length === 0
            ? 'Live radio'
            : track.artists.map((artist, index) => (
                <span key={artist.id}>
                  {index > 0 && ', '}
                  <Link href={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
                    {artist.name}
                  </Link>
                </span>
              ))}
        </p>
      </div>
      <LikeButton track={track} className="shrink-0" />
    </div>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck`
Expected: `Tests  173 passed (173)`: 41 (Task 3) + 91 (lib/player) + 20 (lib/queries) + format 10 + controls 7 + media 4. No type errors.

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add UI primitives and the player controls"
```

### Task 9: Queue, lyrics and Now Playing

**Files:**
- Create: `apps/web/lib/color.ts`, `apps/web/lib/use-dominant-color.ts`, `apps/web/lib/ui-store.ts`, `apps/web/components/tracks/equalizer.tsx`, `apps/web/components/player/lyrics-panel.tsx`, `apps/web/components/player/queue-panel.tsx`, `apps/web/components/player/now-playing.tsx`
- Test: `apps/web/lib/color.test.ts`, `apps/web/lib/ui-store.test.ts`, `apps/web/components/player/lyrics-panel.test.tsx`, `apps/web/components/player/queue-panel.test.tsx`, `apps/web/components/player/now-playing.test.tsx`

**Interfaces:**
- Consumes:
  - `findActiveLineIndex` from `@riff/core`, and `useLyrics` from Task 7.
  - The player (Task 6), and the primitives and controls from Task 8.
- Produces:
  - `color.ts`: `Rgb`, `dominantColor(rgba): Rgb | null`, `backdropColor(rgb): Rgb` (HSL lightness clamped to [0.14, 0.28]), and `lightness(rgb)`.
  - `useDominantColor(src): Rgb | null`: samples a 16×16 canvas with CORS and caches per URL.
  - `ui-store.ts`:
    - `PanelTab = 'queue'|'lyrics'|'nowPlaying'`, `uiStore`, `useUi(selector)`
    - `ui.toggleSidebar()`, `ui.togglePanel(tab)`, `ui.showPanel(tab | null)`, `ui.setNowPlayingOpen(open)`
  - `<Equalizer playing className?>`.
  - `<LyricsPanel className?>` and `MANUAL_SCROLL_PAUSE_MS = 3000`. The panel owns its scroll box, so auto-scroll never moves the page or sheet around it.
  - `<QueuePanel>` and `queueDropIndex(upNext, overUid)`.
  - `now-playing.tsx`: `<NowPlayingPanel>`, `<NowPlayingSheet>` (the phone's full-screen view, with Lyrics and Queue tabs), `SOURCE_NAMES`, and `backdrop(color)`.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/color.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { backdropColor, dominantColor, lightness } from './color';

type Rgba = [number, number, number, number];

function image(...regions: [count: number, pixel: Rgba][]): Uint8ClampedArray {
  const pixels = regions.flatMap(([count, pixel]) => Array.from({ length: count }, () => pixel));
  return new Uint8ClampedArray(pixels.flat());
}

describe('dominantColor', () => {
  test('finds a single flat colour', () => {
    expect(dominantColor(image([256, [200, 40, 40, 255]]))).toEqual([200, 40, 40]);
  });

  test('prefers the largest saturated area over greys, black and white', () => {
    const pixels = image(
      [90, [128, 128, 128, 255]],
      [60, [250, 250, 250, 255]],
      [50, [5, 5, 5, 255]],
      [56, [30, 90, 200, 255]],
    );
    expect(dominantColor(pixels)).toEqual([30, 90, 200]);
  });

  test('averages near-identical shades in one bucket', () => {
    const pixels = image([10, [200, 100, 20, 255]], [10, [204, 104, 24, 255]]);
    expect(dominantColor(pixels)).toEqual([202, 102, 22]);
  });

  test('uses the greys when that is all there is', () => {
    expect(dominantColor(image([64, [120, 120, 120, 255]]))).toEqual([120, 120, 120]);
  });

  test('ignores transparent pixels; a fully transparent image has no colour', () => {
    expect(dominantColor(image([64, [255, 0, 0, 0]]))).toBeNull();
  });
});

describe('backdropColor', () => {
  test('keeps backdrops dark enough for white text', () => {
    for (const rgb of [
      [255, 255, 255],
      [255, 230, 0],
      [30, 90, 200],
      [0, 0, 0],
    ] as [number, number, number][]) {
      const l = lightness(backdropColor(rgb));
      expect(l).toBeGreaterThanOrEqual(0.12);
      expect(l).toBeLessThanOrEqual(0.3);
    }
  });

  test('keeps the hue', () => {
    const [r, g, b] = backdropColor([30, 90, 200]);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });
});
```

`apps/web/lib/ui-store.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { ui, uiStore } from './ui-store';

beforeEach(() => ui.showPanel(null));

test('togglePanel opens a tab, switches tabs, and closes the showing tab', () => {
  ui.togglePanel('queue');
  expect(uiStore.getState().panel).toBe('queue');
  ui.togglePanel('lyrics');
  expect(uiStore.getState().panel).toBe('lyrics');
  ui.togglePanel('lyrics');
  expect(uiStore.getState().panel).toBeNull();
});
```

`apps/web/components/player/lyrics-panel.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiError, stubApi } from '@/test/api-stub';
import { station, track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { LyricsPanel } from './lyrics-panel';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Mix' };
const synced = {
  synced: [
    { timeMs: 0, text: 'First line' },
    { timeMs: 10_000, text: 'Second line' },
    { timeMs: 20_000, text: 'Third line' },
    { timeMs: 30_000, text: 'Fourth line' },
  ],
  plain: null,
  instrumental: false,
};

let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  player.actions.reset();
  scrollTo = vi.fn();
  Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo'];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPanel(lyrics: unknown) {
  stubApi({
    'GET /api/tracks/audius:t1/lyrics': () =>
      lyrics instanceof Response ? lyrics : Response.json(lyrics),
  });
  act(() => player.actions.playContext([track(1)], 0, ctx));
  const { wrapper } = queryWrapper();
  return render(<LyricsPanel />, { wrapper });
}

const at = (seconds: number) => act(() => player.store.setState({ position: seconds }));

describe('LyricsPanel', () => {
  test('highlights the line being sung and seeks when a line is clicked', async () => {
    renderPanel(synced);
    at(12);
    expect(await screen.findByRole('button', { name: 'Second line' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fourth line' }));
    expect(player.store.getState().position).toBe(30);
  });

  test('pauses auto-scroll for 3 s after the listener scrolls', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    renderPanel(synced);
    await screen.findByRole('list', { name: 'Lyrics' });
    // Opening the panel centres the current line; count only what follows.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockClear();
    at(10);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent.wheel(screen.getByRole('list', { name: 'Lyrics' }));
    at(20);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    now.mockReturnValue(103_001);
    at(30);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  test('says so when there are no lyrics', async () => {
    renderPanel(apiError(404, 'NOT_FOUND', 'No lyrics for this track'));
    expect(await screen.findByText('No lyrics for this track.')).toBeInTheDocument();
  });

  test('shows plain lyrics when there are no timings', async () => {
    renderPanel({ synced: null, plain: 'Line one\nLine two', instrumental: false });
    expect(await screen.findByText(/Line one/)).toBeInTheDocument();
  });

  test('offers a retry when loading fails', async () => {
    renderPanel(apiError(504, 'UPSTREAM_TIMEOUT'));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  test('explains that live radio has no lyrics, without asking the API', () => {
    const { requests } = stubApi({});
    act(() => player.actions.playContext([station(1)], 0, { type: 'radio', name: 'Radio' }));
    const { wrapper } = queryWrapper();
    render(<LyricsPanel />, { wrapper });
    expect(screen.getByText('Lyrics aren’t available for live radio.')).toBeInTheDocument();
    expect(requests).toEqual([]);
  });
});
```

`apps/web/components/player/queue-panel.test.tsx`:

```tsx
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { QueuePanel, queueDropIndex } from './queue-panel';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Night drive' };

beforeEach(() => {
  player.actions.reset();
});

function setup() {
  act(() => {
    player.actions.playContext(tracks(3), 0, ctx);
    player.actions.addToQueue([track(8), track(9)]);
  });
  render(<QueuePanel />);
}

const titlesIn = (heading: string) => {
  const section = screen.getByRole('heading', { name: heading }).parentElement?.nextElementSibling;
  return within(section as HTMLElement)
    .getAllByRole('listitem')
    .map((row) => row.textContent);
};

describe('QueuePanel', () => {
  test('shows what is playing, the queue and the rest of the context', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Track 1, now playing' })).toBeDisabled();
    expect(titlesIn('Next in queue')).toEqual(['Track 8Artist 8', 'Track 9Artist 9']);
    expect(titlesIn('Next from Night drive')).toEqual(['Track 2Artist 2', 'Track 3Artist 3']);
  });

  test('clicking an upcoming track plays it', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play Track 3' }));
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t3');
  });

  test('removes one item, or clears the whole queue', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Track 8 from the queue' }));
    expect(titlesIn('Next in queue')).toEqual(['Track 9Artist 9']);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('heading', { name: 'Next in queue' })).not.toBeInTheDocument();
  });

  test('empty queue explains how to fill it', () => {
    render(<QueuePanel />);
    expect(screen.getByText(/Your queue is empty/)).toBeInTheDocument();
  });

  test('queueDropIndex maps a drop target to its position', () => {
    const upNext = [
      { uid: 'a', track: track(1) },
      { uid: 'b', track: track(2) },
    ];
    expect(queueDropIndex(upNext, 'b')).toBe(1);
    expect(queueDropIndex(upNext, 'zz')).toBeNull();
    expect(queueDropIndex(upNext, null)).toBeNull();
  });
});
```

`apps/web/components/player/now-playing.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ui } from '@/lib/ui-store';
import { stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { NowPlayingPanel, NowPlayingSheet } from './now-playing';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));

const withAlbum = track(1, {
  album: { id: 'audius:album:7', title: 'Night Shift' },
  permalink: 'https://audius.co/artist/track-1',
});

beforeEach(() => {
  player.actions.reset();
  ui.setNowPlayingOpen(false);
  stubApi({
    'GET /api/me/likes/ids': [],
    'GET /api/tracks/audius:t1/lyrics': { synced: null, plain: 'La la', instrumental: false },
  });
});

test('the panel credits the track, links the album and the source', () => {
  act(() => player.actions.playContext([withAlbum], 0, { type: 'search', name: 'Search' }));
  const { wrapper } = queryWrapper();
  render(<NowPlayingPanel />, { wrapper });
  expect(screen.getByRole('link', { name: 'Artist 1' })).toHaveAttribute(
    'href',
    '/artist/audius:a1',
  );
  expect(screen.getByRole('link', { name: 'Night Shift' })).toHaveAttribute(
    'href',
    '/collection/audius:album:7',
  );
  expect(screen.getByRole('link', { name: /Open on Audius/ })).toHaveAttribute(
    'href',
    'https://audius.co/artist/track-1',
  );
});

test('the phone sheet opens only with a track, titled by the context', async () => {
  const { wrapper } = queryWrapper();
  act(() => ui.setNowPlayingOpen(true));
  render(<NowPlayingSheet />, { wrapper });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(() => player.actions.playContext([withAlbum], 0, { type: 'liked', name: 'Liked Songs' }));
  expect(await screen.findByRole('dialog', { name: 'Liked Songs' })).toBeInTheDocument();
  expect(await screen.findByText('La la')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run lib/color lib/ui-store components/player`
Expected: the five new files FAIL with `Failed to resolve import`. `controls.test.tsx` still passes.

- [ ] **Step 3: Write the colour helpers and the UI store**

`apps/web/lib/color.ts`:

```ts
export type Rgb = [number, number, number];

/** Quantisation step: 4 bits per channel, so near-identical shades share a bucket. */
const STEP = 16;

const isNeutral = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 28 || min > 235 || max - min < 24;
};

/**
 * The most common colour in RGBA pixel data (a small downscaled image). Saturated colours
 * beat greys, black and white, which only win when there is nothing else. Returns the average
 * of the winning bucket, or null for a fully transparent image.
 */
export function dominantColor(data: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<
    number,
    { count: number; r: number; g: number; b: number; neutral: boolean }
  >();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    if ((data[i + 3] as number) < 128) continue;
    const key = ((r / STEP) << 8) | ((g / STEP) << 4) | (b / STEP);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, neutral: isNeutral(r, g, b) };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best: { count: number; r: number; g: number; b: number; neutral: boolean } | null = null;
  for (const bucket of buckets.values()) {
    if (
      !best ||
      (best.neutral && !bucket.neutral) ||
      (best.neutral === bucket.neutral && bucket.count > best.count)
    ) {
      best = bucket;
    }
  }
  if (!best) return null;
  return [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
  ];
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) =>
    Math.round(v * 255),
  ) as Rgb;
}

/** HSL lightness in [0, 1]. */
export const lightness = (rgb: Rgb): number => toHsl(rgb)[2];

/** The colour dimmed and tamed into a backdrop that white text stays readable on. */
export function backdropColor(rgb: Rgb): Rgb {
  const [h, s, l] = toHsl(rgb);
  return fromHsl([h, Math.min(s, 0.55), Math.min(Math.max(l * 0.45, 0.14), 0.28)]);
}
```

`apps/web/lib/use-dominant-color.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { backdropColor, dominantColor, type Rgb } from './color';

const cache = new Map<string, Rgb | null>();
const SAMPLE = 16;

function sample(image: HTMLImageElement): Rgb | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
  // Throws if the host didn't send CORS headers (a tainted canvas); callers get null.
  const color = dominantColor(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  return color && backdropColor(color);
}

/** A dark backdrop colour taken from the artwork at `src`, or null while loading or unknown. */
export function useDominantColor(src: string | undefined): Rgb | null {
  const [color, setColor] = useState<Rgb | null>(() => (src ? (cache.get(src) ?? null) : null));
  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    if (cache.has(src)) {
      setColor(cache.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      let result: Rgb | null = null;
      try {
        result = sample(image);
      } catch {
        result = null;
      }
      cache.set(src, result);
      if (!cancelled) setColor(result);
    };
    image.onerror = () => {
      cache.set(src, null);
      if (!cancelled) setColor(null);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return color;
}
```

`apps/web/lib/ui-store.ts`:

```ts
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type PanelTab = 'queue' | 'lyrics' | 'nowPlaying';

export interface UiState {
  /** Desktop sidebar shows icons only. */
  sidebarCollapsed: boolean;
  /** The desktop right panel's tab, or null when it is closed. */
  panel: PanelTab | null;
  /** The phone's full-screen Now Playing sheet. */
  nowPlayingOpen: boolean;
}

export const uiStore = createStore<UiState>()(() => ({
  sidebarCollapsed: false,
  panel: null,
  nowPlayingOpen: false,
}));

export const ui = {
  toggleSidebar: () => uiStore.setState((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  /** Opens the panel on `tab`, or closes it if that tab is already showing. */
  togglePanel: (tab: PanelTab) =>
    uiStore.setState((s) => ({ panel: s.panel === tab ? null : tab })),
  showPanel: (tab: PanelTab | null) => uiStore.setState({ panel: tab }),
  setNowPlayingOpen: (open: boolean) => uiStore.setState({ nowPlayingOpen: open }),
};

export const useUi = <T>(selector: (state: UiState) => T): T => useStore(uiStore, selector);
```

- [ ] **Step 4: Write the views**

`apps/web/components/tracks/equalizer.tsx`:

```tsx
import { cn } from '@/lib/cn';

/** Animated bars marking the playing track; still when paused or with reduced motion. */
export function Equalizer({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('flex h-3.5 items-end gap-[2px]', className)}>
      {[0, 180, 90].map((delay) => (
        <span
          key={delay}
          className={cn(
            'h-full w-[3px] origin-bottom rounded-full bg-accent',
            playing ? 'motion-safe:animate-eq' : 'scale-y-50',
          )}
          style={{ animationDelay: `-${delay}ms` }}
        />
      ))}
    </span>
  );
}
```

`apps/web/components/player/lyrics-panel.tsx`:

```tsx
'use client';

import { findActiveLineIndex, type LyricLine } from '@riff/core';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { player, usePlayer } from '@/lib/player/instance';
import { useLyrics } from '@/lib/queries/catalog';

/** After the listener scrolls the lyrics themselves, auto-scroll waits this long. */
export const MANUAL_SCROLL_PAUSE_MS = 3_000;

function Message({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-8 text-center text-muted text-sm">{children}</p>;
}

/** Lyrics for the current track: synced lines follow playback and seek on click. */
export function LyricsPanel({ className }: { className?: string }) {
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  const lyrics = useLyrics(track && !track.isLive ? track.id : null);

  let body: React.ReactNode;
  if (!track) body = <Message>Play something to see its lyrics.</Message>;
  else if (track.isLive) body = <Message>Lyrics aren’t available for live radio.</Message>;
  else if (lyrics.isPending)
    body = (
      <div role="status" aria-label="Loading lyrics" className="flex flex-col gap-4 py-4">
        {[70, 55, 80, 45, 65].map((width) => (
          <div
            key={width}
            className="h-6 animate-pulse rounded-full bg-raised"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    );
  else if (lyrics.isError)
    body = (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-muted text-sm">Couldn’t load lyrics.</p>
        <Button size="sm" onClick={() => lyrics.refetch()}>
          Retry
        </Button>
      </div>
    );
  else if (!lyrics.data) body = <Message>No lyrics for this track.</Message>;
  else if (lyrics.data.instrumental) body = <Message>This track is instrumental.</Message>;
  else if (lyrics.data.synced?.length) body = <SyncedLyrics lines={lyrics.data.synced} />;
  else
    body = (
      <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
        <p className="whitespace-pre-line py-4 text-lg leading-relaxed">{lyrics.data.plain}</p>
      </div>
    );

  return <div className={cn('flex min-h-0 flex-col', className)}>{body}</div>;
}

function SyncedLyrics({ lines }: { lines: LyricLine[] }) {
  const position = usePlayer((s) => s.position);
  const active = findActiveLineIndex(lines, position * 1000);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const manualScrollAt = useRef(0);

  useEffect(() => {
    if (active < 0 || Date.now() - manualScrollAt.current < MANUAL_SCROLL_PAUSE_MS) return;
    const box = scroller.current;
    const line = list.current?.children[active] as HTMLElement | undefined;
    if (!box || !line) return;
    // Scroll only the lyrics box (scrollIntoView would also move the page or sheet around it).
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [active]);

  const markManual = () => {
    manualScrollAt.current = Date.now();
  };

  return (
    <div
      ref={scroller}
      onWheel={markManual}
      onTouchMove={markManual}
      className="relative h-full min-h-0 overflow-y-auto overscroll-contain"
    >
      <ol ref={list} aria-label="Lyrics" className="flex flex-col gap-1 py-4">
        {lines.map((line, index) => (
          <li key={`${line.timeMs}-${index}`}>
            <button
              type="button"
              aria-current={index === active ? 'true' : undefined}
              onClick={() => player.actions.seek(line.timeMs / 1000)}
              className={cn(
                'w-full rounded-lg px-1 py-1 text-left font-semibold text-xl leading-snug transition-colors hover:text-fg md:text-2xl',
                index === active ? 'text-fg' : index < active ? 'text-faint' : 'text-muted',
              )}
            >
              {line.text || '♪'}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

`QueuePanel` selects `order` and `index` and slices during render. Selecting `order.slice(…)` directly would hand `useShallow` a new array on every read and loop forever.

`apps/web/components/player/queue-panel.tsx`:

```tsx
'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { QueueItem } from '@riff/core';
import { GripVertical, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Artwork } from '@/components/media/artwork';
import { Equalizer } from '@/components/tracks/equalizer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { artistNames } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';

/** Where a dragged queued item lands: the index of the item it was dropped on. */
export function queueDropIndex(
  upNext: readonly QueueItem[],
  overUid: string | null,
): number | null {
  if (overUid === null) return null;
  const index = upNext.findIndex((item) => item.uid === overUid);
  return index < 0 ? null : index;
}

function Row({
  item,
  playing,
  current = false,
  sortable = false,
}: {
  item: QueueItem;
  playing?: boolean;
  current?: boolean;
  sortable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.uid,
    disabled: !sortable,
  });
  const { track } = item;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex items-center gap-2 rounded-lg p-1.5 hover:bg-raised',
        isDragging && 'relative z-10 bg-raised shadow-lg shadow-black/40',
      )}
    >
      {sortable && (
        <button
          type="button"
          aria-label={`Reorder ${track.title}`}
          className="cursor-grab touch-none rounded p-1 text-faint hover:text-fg"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <button
        type="button"
        disabled={current}
        onClick={() => player.actions.jumpTo(item.uid)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={current ? `${track.title}, now playing` : `Play ${track.title}`}
      >
        <Artwork artwork={track.artwork} size="sm" className="size-10 shrink-0 rounded" />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', current && 'text-accent')}>
            {track.title}
          </span>
          <span className="block truncate text-muted text-xs">
            {artistNames(track.artists) || 'Live radio'}
          </span>
        </span>
        {current && <Equalizer playing={playing ?? false} className="mr-2" />}
      </button>
      {!current && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          aria-label={`Remove ${track.title} from the queue`}
          onClick={() => player.actions.removeFromQueue(item.uid)}
        >
          <X />
        </Button>
      )}
    </li>
  );
}

function Heading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1.5 pt-4 pb-2">
      <h3 className="font-semibold text-sm">{children}</h3>
      {action}
    </div>
  );
}

/** Now playing, the user's queue (drag to reorder), then the rest of the context. */
export function QueuePanel() {
  // Select stable references only; a derived array here would re-render forever.
  const { current, upNext, order, index, contextName, playing } = usePlayer(
    useShallow((s) => ({
      current: s.queue.current,
      upNext: s.queue.upNext,
      order: s.queue.order,
      index: s.queue.index,
      contextName: s.queue.context?.name ?? null,
      playing: s.status === 'playing',
    })),
  );
  const following = order.slice(index + 1);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!current && upNext.length === 0) {
    return (
      <p className="px-1.5 py-8 text-center text-muted text-sm">
        Your queue is empty. Play something, or use “Add to queue” on any track.
      </p>
    );
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const to = queueDropIndex(upNext, over ? String(over.id) : null);
    if (to !== null && active.id !== over?.id) player.actions.moveInQueue(String(active.id), to);
  };

  return (
    <div className="flex flex-col">
      {current && (
        <>
          <Heading>Now playing</Heading>
          <ul>
            <Row item={current} current playing={playing} />
          </ul>
        </>
      )}
      {upNext.length > 0 && (
        <>
          <Heading
            action={
              <Button variant="ghost" size="sm" onClick={() => player.actions.clearUpNext()}>
                Clear
              </Button>
            }
          >
            Next in queue
          </Heading>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={upNext.map((item) => item.uid)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {upNext.map((item) => (
                  <Row key={item.uid} item={item} sortable />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}
      {following.length > 0 && (
        <>
          <Heading>Next from {contextName ?? 'this list'}</Heading>
          <ul>
            {following.map((item) => (
              <Row key={item.uid} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

`apps/web/components/player/now-playing.tsx`:

```tsx
'use client';

import type { SourceId, Track } from '@riff/core';
import { ChevronDown, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Artwork, pickArtwork } from '@/components/media/artwork';
import { LikeButton } from '@/components/tracks/like-button';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Rgb } from '@/lib/color';
import { usePlayer } from '@/lib/player/instance';
import { ui, useUi } from '@/lib/ui-store';
import { useDominantColor } from '@/lib/use-dominant-color';
import { LyricsPanel } from './lyrics-panel';
import { QueuePanel } from './queue-panel';
import { SeekBar } from './seek-bar';
import { Transport } from './transport';

export const SOURCE_NAMES: Record<SourceId, string> = {
  audius: 'Audius',
  jamendo: 'Jamendo',
  radio: 'Radio Browser',
};

/** A top-down wash of the artwork's colour, fading into the page. */
export const backdrop = (color: Rgb | null) =>
  color
    ? { backgroundImage: `linear-gradient(to bottom, rgb(${color.join(' ')}) 0%, transparent 75%)` }
    : undefined;

function Credits({ track }: { track: Track }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-xl tracking-tight">{track.title}</p>
      <p className="truncate text-muted">
        {track.artists.length === 0
          ? 'Live radio'
          : track.artists.map((artist, index) => (
              <span key={artist.id}>
                {index > 0 && ', '}
                <Link href={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
                  {artist.name}
                </Link>
              </span>
            ))}
      </p>
    </div>
  );
}

function Attribution({ track }: { track: Track }) {
  return (
    <div className="flex flex-col gap-2 text-muted text-sm">
      {track.album && (
        <p className="truncate">
          From{' '}
          <Link href={`/collection/${track.album.id}`} className="text-fg hover:underline">
            {track.album.title}
          </Link>
        </p>
      )}
      {track.permalink && (
        <a
          href={track.permalink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-fg"
        >
          Open on {SOURCE_NAMES[track.source]} <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}

/** The right panel's Now Playing tab. */
export function NowPlayingPanel() {
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  const color = useDominantColor(track ? pickArtwork(track.artwork, 'sm') : undefined);
  if (!track) {
    return <p className="py-8 text-center text-muted text-sm">Nothing is playing.</p>;
  }
  return (
    <div className="-mx-4 flex flex-col gap-5 px-4 pt-4 pb-6" style={backdrop(color)}>
      <Artwork
        artwork={track.artwork}
        size="lg"
        className="w-full rounded-xl shadow-2xl shadow-black/50"
      />
      <div className="flex items-start justify-between gap-3">
        <Credits track={track} />
        <LikeButton track={track} className="mt-1 shrink-0" />
      </div>
      <Attribution track={track} />
    </div>
  );
}

/** The phone's full-screen player: artwork, controls, lyrics and the queue. */
export function NowPlayingSheet() {
  const open = useUi((s) => s.nowPlayingOpen);
  const track = usePlayer((s) => s.queue.current?.track ?? null);
  const contextName = usePlayer((s) => s.queue.context?.name ?? null);
  const color = useDominantColor(track ? pickArtwork(track.artwork, 'sm') : undefined);
  return (
    <Sheet open={open && track !== null} onOpenChange={ui.setNowPlayingOpen}>
      <SheetContent aria-describedby={undefined} style={backdrop(color)}>
        <header className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close Now Playing">
              <ChevronDown />
            </Button>
          </SheetClose>
          <SheetTitle className="flex-1 truncate text-center font-medium text-muted text-sm">
            {contextName ?? 'Now playing'}
          </SheetTitle>
          <span className="size-10" aria-hidden />
        </header>
        {track && (
          <div className="flex flex-col gap-6 px-6 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <Artwork
              artwork={track.artwork}
              size="lg"
              className="mx-auto w-full max-w-sm rounded-xl shadow-2xl shadow-black/50"
            />
            <div className="flex items-center justify-between gap-3">
              <Credits track={track} />
              <LikeButton track={track} className="shrink-0" />
            </div>
            <SeekBar />
            <Transport large />
            <Tabs defaultValue="lyrics" className="flex flex-col gap-2 rounded-2xl bg-black/20 p-3">
              <TabsList aria-label="More about this track">
                <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
                <TabsTrigger value="queue">Queue</TabsTrigger>
              </TabsList>
              <TabsContent value="lyrics">
                <LyricsPanel className="h-[55dvh] px-1" />
              </TabsContent>
              <TabsContent value="queue" className="max-h-[55dvh] overflow-y-auto">
                <QueuePanel />
              </TabsContent>
            </Tabs>
            <Attribution track={track} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck`
Expected: `Tests  194 passed (194)`: 173 plus colour 7, UI store 1, lyrics 6, queue 5, Now Playing 2. No type errors.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add the queue, lyrics and Now Playing views"
```

### Task 10: The virtualised track list and its row menu

**Files:**
- Create: `apps/web/components/tracks/track-menu.tsx`, `apps/web/components/tracks/track-list.tsx`
- Test: `apps/web/components/tracks/track-list.test.tsx`

**Interfaces:**
- Consumes:
  - `useWindowVirtualizer` from `@tanstack/react-virtual`.
  - The player (Task 6).
  - `useLikedIds`, `useToggleLike`, `usePlaylists` and `useAddToPlaylist` from Task 7.
  - The menu primitives, `LikeButton`, `LiveBadge` and `Artwork` from Task 8.
  - `Equalizer` and `SOURCE_NAMES` from Task 9.
- Produces:
  - `<TrackList tracks context rowKeys? showAlbum? onRemove?(index) onEndReached?>`:
    - an `ol` labelled by `context.name`, virtualised against the window
    - the album column appears only when a track has an album
  - For Task 13's sortable list: `<TrackRow …>` (memoised), `COLUMNS`, `useNowPlaying()` (returns `{ currentId, playing }`), and `ROW_HEIGHT`.
  - `<TrackListSkeleton rows?>`.
  - `track-menu.tsx`: `<TrackMenuItems track onRemove? kit>`, with `dropdownKit` and `contextKit`. The items are:
    - Play next, Add to queue
    - Add to playlist ▸, Save to / Remove from Liked Songs (both hidden for live stations)
    - Remove from this playlist (only with `onRemove`)
    - Go to artist, Go to album, Open on <source>

- [ ] **Step 1: Write the failing test**

`apps/web/components/tracks/track-list.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stubApi } from '@/test/api-stub';
import { station, track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { TrackList } from './track-list';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const ctx = { type: 'playlist' as const, id: 'p1', name: 'Night drive' };
const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

let requests: ReturnType<typeof stubApi>['requests'];

beforeEach(() => {
  player.actions.reset();
  ({ requests } = stubApi({
    'GET /api/me/likes/ids': [],
    'GET /api/me/playlists': [
      {
        id: PID,
        name: 'Gym',
        description: null,
        coverUrl: null,
        isPublic: false,
        trackCount: 0,
        covers: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
    [`POST /api/me/playlists/${PID}/tracks`]: () => Response.json({ entries: [] }, { status: 201 }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderList(list = tracks(3), props: Partial<Parameters<typeof TrackList>[0]> = {}) {
  const { wrapper } = queryWrapper();
  return render(<TrackList tracks={list} context={ctx} {...props} />, { wrapper });
}

const row = (title: string) =>
  screen.getAllByRole('listitem').find((r) => within(r).queryByText(title)) as HTMLElement;

describe('TrackList', () => {
  test('plays the list from the chosen row, with the list as context', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'Play Track 2' }));
    const { queue } = player.store.getState();
    expect(queue.current?.track.id).toBe('audius:t2');
    expect(queue.context).toEqual(ctx);
    expect(queue.order.map((item) => item.track.id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
    ]);
  });

  test('marks the playing row, and its button pauses', () => {
    act(() => {
      player.actions.playContext(tracks(3), 1, ctx);
      player.store.setState({ status: 'playing' });
    });
    renderList();
    expect(row('Track 2')).toHaveAttribute('aria-current', 'true');
    const toggle = vi.spyOn(player.actions, 'togglePlay');
    fireEvent.click(screen.getByRole('button', { name: 'Pause Track 2' }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  test('the "…" menu queues tracks', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 3' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Play next' }));
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t3');
    expect(toast).toHaveBeenCalledWith('Playing next');
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 1' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add to queue' }));
    expect(player.store.getState().queue.upNext.map((item) => item.track.id)).toEqual([
      'audius:t1',
    ]);
  });

  test('right-click opens the same menu, including Add to playlist', async () => {
    renderList();
    fireEvent.contextMenu(row('Track 2').firstElementChild as HTMLElement);
    const trigger = await screen.findByRole('menuitem', { name: 'Add to playlist' });
    trigger.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Gym' }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ trackIds: ['audius:t2'] }),
    );
  });

  test('offers removal only where the caller allows it', async () => {
    const onRemove = vi.fn();
    renderList(tracks(2), { onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 2' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Remove from this playlist' }),
    );
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  test('stations get a LIVE badge and no like or playlist actions', async () => {
    renderList([station(1)]);
    expect(within(row('Station 1')).getByText('LIVE')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More options for Station 1' }));
    await screen.findByRole('menuitem', { name: 'Add to queue' });
    expect(screen.queryByRole('menuitem', { name: 'Add to playlist' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Liked Songs/ })).not.toBeInTheDocument();
  });

  test('Go to artist navigates', async () => {
    renderList([track(4)]);
    await userEvent.click(screen.getByRole('button', { name: 'More options for Track 4' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Go to artist' }));
    expect(router.push).toHaveBeenCalledWith('/artist/audius:a4');
  });

  test('asks for more rows near the end', () => {
    const onEndReached = vi.fn();
    renderList(tracks(4), { onEndReached });
    expect(onEndReached).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @riff/web exec vitest run components/tracks`
Expected: FAIL, with `Failed to resolve import "./track-list"`. `media.test.tsx` covers `LikeButton` and still passes.

- [ ] **Step 3: Write the menu and the list**

Each row's title is a stretched button: its `::after` covers the row, so a click anywhere plays. Artist links, the like button and the menu sit above it (`relative`). The list is an `ol` with `aria-posinset`/`aria-setsize`. Biome's a11y rules reject ARIA table roles on divs.

`apps/web/components/tracks/track-menu.tsx`:

```tsx
'use client';

import type { Track } from '@riff/core';
import {
  Disc3,
  ExternalLink,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ComponentType, ReactNode } from 'react';
import { toast } from 'sonner';
import { SOURCE_NAMES } from '@/components/player/now-playing';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from '@/components/ui/menu';
import { player } from '@/lib/player/instance';
import { useLikedIds, useToggleLike } from '@/lib/queries/library';
import { useAddToPlaylist, usePlaylists } from '@/lib/queries/playlists';

interface MenuKit {
  Item: ComponentType<{ onSelect?: () => void; disabled?: boolean; children: ReactNode }>;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
  SubContent: ComponentType<{ children: ReactNode }>;
  Separator: ComponentType;
}

/** The same items render in the "…" dropdown and the right-click menu. */
export const dropdownKit: MenuKit = {
  Item: MenuItem,
  Sub: MenuSub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
  Separator: MenuSeparator,
};

export const contextKit: MenuKit = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  Separator: ContextMenuSeparator,
};

export interface TrackMenuProps {
  track: Track;
  /** Shown on a playlist the user owns. */
  onRemove?: () => void;
}

export function TrackMenuItems({ track, onRemove, kit }: TrackMenuProps & { kit: MenuKit }) {
  const { Item, Sub, SubTrigger, SubContent, Separator } = kit;
  const router = useRouter();
  const liked = useLikedIds().has(track.id);
  const toggleLike = useToggleLike();
  const playlists = usePlaylists();
  const addToPlaylist = useAddToPlaylist();
  const artist = track.artists[0];

  return (
    <>
      <Item
        onSelect={() => {
          player.actions.playNext([track]);
          toast('Playing next');
        }}
      >
        <ListStart /> Play next
      </Item>
      <Item
        onSelect={() => {
          player.actions.addToQueue([track]);
          toast('Added to queue');
        }}
      >
        <ListEnd /> Add to queue
      </Item>
      {!track.isLive && (
        <>
          <Separator />
          <Sub>
            <SubTrigger>
              <ListPlus /> Add to playlist
            </SubTrigger>
            <SubContent>
              {playlists.data?.length ? (
                playlists.data.map((playlist) => (
                  <Item
                    key={playlist.id}
                    onSelect={() => addToPlaylist.mutate({ playlist, trackIds: [track.id] })}
                  >
                    {playlist.name}
                  </Item>
                ))
              ) : (
                <Item disabled>{playlists.isPending ? 'Loading…' : 'No playlists yet'}</Item>
              )}
            </SubContent>
          </Sub>
          <Item onSelect={() => toggleLike.mutate({ track, like: !liked })}>
            <Heart /> {liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
          </Item>
        </>
      )}
      {onRemove && (
        <Item onSelect={onRemove}>
          <Trash2 /> Remove from this playlist
        </Item>
      )}
      <Separator />
      {artist && (
        <Item onSelect={() => router.push(`/artist/${artist.id}`)}>
          <UserRound /> Go to artist
        </Item>
      )}
      {track.album && (
        <Item onSelect={() => router.push(`/collection/${track.album?.id}`)}>
          <Disc3 /> Go to album
        </Item>
      )}
      {track.permalink && (
        <Item onSelect={() => window.open(track.permalink, '_blank', 'noopener,noreferrer')}>
          <ExternalLink /> Open on {SOURCE_NAMES[track.source]}
        </Item>
      )}
    </>
  );
}
```

`apps/web/components/tracks/track-list.tsx`:

```tsx
'use client';

import type { QueueContext, Track } from '@riff/core';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Clock3, MoreHorizontal, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Artwork } from '@/components/media/artwork';
import { LiveBadge } from '@/components/player/seek-bar';
import { Button } from '@/components/ui/button';
import {
  ContextMenuContent,
  ContextMenuRoot,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuTrigger,
} from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';
import { Equalizer } from './equalizer';
import { LikeButton } from './like-button';
import { contextKit, dropdownKit, TrackMenuItems } from './track-menu';

export const ROW_HEIGHT = 56;

/** The playing track's id, and whether audio is (about to be) playing. */
export function useNowPlaying() {
  return usePlayer(
    useShallow((s) => ({
      currentId: s.queue.current?.track.id ?? null,
      playing: s.status === 'playing' || s.status === 'loading',
    })),
  );
}

export interface TrackListProps {
  tracks: readonly Track[];
  /** What the queue plays from when a row is played. */
  context: QueueContext;
  /** Stable row keys, e.g. playlist entry ids (the same track can appear twice). */
  rowKeys?: readonly string[];
  showAlbum?: boolean;
  /** Called with a row index to offer "Remove from this playlist". */
  onRemove?: (index: number) => void;
  /** Called when the last rows come into view (to load the next page). */
  onEndReached?: () => void;
}

export const COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[2.5rem_minmax(0,1fr)_auto_3.5rem_2.5rem]';
const COLUMNS_WITH_ALBUM =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto_3.5rem_2.5rem]';

/** A virtualised list of tracks that scrolls with the page. */
export function TrackList({
  tracks,
  context,
  rowKeys,
  showAlbum = false,
  onRemove,
  onEndReached,
}: TrackListProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    setOffset(listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0);
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: tracks.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin: offset,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? -1;

  useEffect(() => {
    if (onEndReached && lastIndex >= tracks.length - 5 && tracks.length > 0) onEndReached();
  }, [lastIndex, tracks.length, onEndReached]);

  const { currentId, playing } = useNowPlaying();
  // Most Audius tracks have no album; keep the column only when it has something to show.
  const albumColumn = showAlbum && tracks.some((track) => track.album);
  const columns = albumColumn ? COLUMNS_WITH_ALBUM : COLUMNS;

  return (
    <div>
      <div
        aria-hidden
        className={cn(
          'hidden items-center gap-3 border-line border-b px-3 pb-2 text-faint text-xs md:grid',
          columns,
        )}
      >
        <span className="text-right">#</span>
        <span>Title</span>
        {albumColumn && <span>Album</span>}
        <span />
        <span className="flex justify-end">
          <Clock3 className="size-4" />
        </span>
        <span />
      </div>
      <ol
        ref={listRef}
        aria-label={context.name}
        className="relative mt-2"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const track = tracks[item.index] as Track;
          return (
            <li
              key={rowKeys?.[item.index] ?? `${track.id}-${item.index}`}
              aria-posinset={item.index + 1}
              aria-setsize={tracks.length}
              aria-current={track.id === currentId ? 'true' : undefined}
              className="absolute inset-x-0 top-0"
              style={{
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <TrackRow
                track={track}
                index={item.index}
                columns={columns}
                showAlbum={albumColumn}
                isCurrent={track.id === currentId}
                playing={playing}
                onPlay={() => {
                  if (track.id === currentId) player.actions.togglePlay();
                  else player.actions.playContext(tracks, item.index, context);
                }}
                onRemove={onRemove ? () => onRemove(item.index) : undefined}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface TrackRowProps {
  track: Track;
  index: number;
  columns: string;
  showAlbum: boolean;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove?: () => void;
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  columns,
  showAlbum,
  isCurrent,
  playing,
  onPlay,
  onRemove,
}: TrackRowProps) {
  const active = isCurrent && playing;
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group relative grid h-14 items-center gap-3 rounded-lg px-3 hover:bg-raised has-focus-visible:bg-raised',
            columns,
          )}
        >
          <span className="relative hidden h-full items-center justify-end md:flex">
            <span
              className={cn(
                'text-faint text-sm tabular-nums group-hover:opacity-0',
                isCurrent && 'opacity-0',
              )}
            >
              {index + 1}
            </span>
            {isCurrent && (
              <Equalizer playing={active} className="absolute right-1 group-hover:opacity-0" />
            )}
            <span
              aria-hidden
              className="absolute right-0 opacity-0 transition-opacity group-hover:opacity-100"
            >
              {active ? (
                <Pause className="size-4 fill-current" />
              ) : (
                <Play className="size-4 fill-current" />
              )}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-3">
            <Artwork artwork={track.artwork} size="sm" className="size-10 shrink-0 rounded" />
            <span className="min-w-0">
              {/* Stretched button: its ::after covers the row, so a click anywhere plays. */}
              <button
                type="button"
                onClick={onPlay}
                aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
                className={cn(
                  'block max-w-full truncate text-left text-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-accent',
                  isCurrent && 'text-accent',
                )}
              >
                {track.title}
              </button>
              <span className="relative block truncate text-muted text-xs">
                {track.isLive ? (
                  <LiveBadge className="px-1.5 py-0 text-[10px]" />
                ) : (
                  track.artists.map((artist, i) => (
                    <span key={artist.id}>
                      {i > 0 && ', '}
                      <Link href={`/artist/${artist.id}`} className="hover:text-fg hover:underline">
                        {artist.name}
                      </Link>
                    </span>
                  ))
                )}
              </span>
            </span>
          </span>
          {showAlbum && (
            <span className="relative hidden min-w-0 truncate text-muted text-sm md:block">
              {track.album ? (
                <Link
                  href={`/collection/${track.album.id}`}
                  className="hover:text-fg hover:underline"
                >
                  {track.album.title}
                </Link>
              ) : null}
            </span>
          )}
          <span className="relative hidden md:block">
            <LikeButton
              track={track}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100"
            />
          </span>
          <span className="hidden text-right text-faint text-sm tabular-nums md:block">
            {track.isLive ? '' : formatDuration(track.durationSec)}
          </span>
          <span className="relative flex justify-end">
            <Menu>
              <MenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More options for ${track.title}`}
                  className="md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <TrackMenuItems track={track} onRemove={onRemove} kit={dropdownKit} />
              </MenuContent>
            </Menu>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <TrackMenuItems track={track} onRemove={onRemove} kit={contextKit} />
      </ContextMenuContent>
    </ContextMenuRoot>
  );
});

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading tracks" className="mt-2 flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 px-3">
          <Skeleton className="size-10 rounded" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck`
Expected: `Tests  202 passed (202)`, and no type errors.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add the virtualised track list with its row menu"
```

### Task 11: The app shell and the Liked Songs page

**Files:**
- Create:
  - `apps/web/components/providers.tsx`
  - `apps/web/components/states/page-state.tsx`
  - `apps/web/components/media/covers.tsx`, `apps/web/components/media/page-header.tsx`
  - `apps/web/components/tracks/play-context-button.tsx`
  - `apps/web/components/shell/{create-playlist-dialog,library-list,sidebar,search-field,user-menu,top-bar,mobile-tab-bar,right-panel,player-shortcuts,app-shell}.tsx`
  - `apps/web/components/player/player-bar.tsx`, `apps/web/components/player/mini-player.tsx`
  - `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/liked/page.tsx`
- Test: `apps/web/components/states/page-state.test.tsx`, `apps/web/components/media/covers.test.tsx`, `apps/web/components/shell/search-field.test.tsx`, `apps/web/components/shell/shell.test.tsx`, `apps/web/app/(app)/liked/page.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3 to 10.
- Produces:
  - Page building blocks:
    - `<Providers>`: QueryClient, plus a sonner `Toaster` placed above the player bar or mini-player.
    - `<ErrorState error onRetry>`: Retry for upstream and network errors, and "Go home" for a 404.
    - `<EmptyState icon title action?>`.
    - `<LikedCover className?>` and `<PlaylistCover playlist className?>`: the playlist's own cover, else a 2×2 mosaic when there are four or more covers, else the first cover or a placeholder.
    - `<PageHeader kind title cover tintFrom? meta?>` (the actions go in as children), and `<PageHeaderSkeleton>`.
    - `<PlayContextButton tracks context loadAll?>` and `sameContext(a, b)`.
  - Shell:
    - `<AppShell>`: layout variables `--sidebar-w` (0 / 5rem / 18rem, or 5rem when collapsed) and `--panel-w` (21rem when the panel is open, desktop only).
    - `<Sidebar>`, `NAV`, `isActive(pathname, href)`.
    - `<LibraryList compact?>` and `<CreatePlaylistDialog>` (wraps a trigger).
    - `<SearchField className?>` (tagged `data-search-input`), `SEARCH_DEBOUNCE_MS`, `<TopBar>`, `<UserMenu>`.
    - `<MobileTabBar>` (Home · Search · Library), `<RightPanel>`, `<PlayerBar>`, `<MiniPlayer>`.
    - `<PlayerShortcuts>`: binds `useShortcuts` to the player, likes, and search focus.
  - Routes: the `(app)` layout, and `/liked`.

- [ ] **Step 1: Write the failing tests**

`apps/web/components/states/page-state.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { ErrorState } from './page-state';

test('upstream failures explain and offer a retry', async () => {
  const onRetry = vi.fn();
  render(<ErrorState error={new ApiRequestError(502, 'UPSTREAM_ERROR', 'x')} onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The music source is having trouble right now.',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

test('a missing page links home instead', () => {
  render(<ErrorState error={new ApiRequestError(404, 'NOT_FOUND', 'x')} onRetry={vi.fn()} />);
  expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

test('network failures say so', () => {
  render(<ErrorState error={new TypeError('Failed to fetch')} onRetry={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not reach Riff.');
});
```

`apps/web/components/media/covers.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PlaylistCover } from './covers';

const srcs = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

test('uses the playlist image when it has one', () => {
  const { container } = render(<PlaylistCover playlist={{ coverUrl: 'c', covers: ['a', 'b'] }} />);
  expect(srcs(container)).toEqual(['c']);
});

test('builds a 2×2 mosaic from four or more artworks', () => {
  const { container } = render(
    <PlaylistCover playlist={{ coverUrl: null, covers: ['a', 'b', 'c', 'd'] }} />,
  );
  expect(srcs(container)).toEqual(['a', 'b', 'c', 'd']);
});

test('shows the first artwork when there are fewer than four, or a placeholder when none', () => {
  const few = render(<PlaylistCover playlist={{ coverUrl: null, covers: ['a', 'b'] }} />);
  expect(srcs(few.container)).toEqual(['a']);
  const none = render(<PlaylistCover playlist={{ coverUrl: null, covers: [] }} />);
  expect(srcs(none.container)).toEqual([]);
});
```

`apps/web/components/shell/search-field.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, SearchField } from './search-field';

const nav = vi.hoisted(() => ({
  pathname: '/',
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.params,
}));

beforeEach(() => {
  vi.useFakeTimers();
  nav.pathname = '/';
  nav.params = new URLSearchParams();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const type = (text: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: text } });

describe('SearchField', () => {
  test('from another page, a pause in typing opens the search page', () => {
    render(<SearchField />);
    type('lofi');
    type('lofi beats');
    expect(nav.router.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(nav.router.push).toHaveBeenCalledOnce();
    expect(nav.router.push).toHaveBeenCalledWith('/search?q=lofi%20beats');
  });

  test('on the search page, it replaces the URL instead of stacking history', () => {
    nav.pathname = '/search';
    nav.params = new URLSearchParams('q=lo');
    render(<SearchField />);
    expect(screen.getByRole('searchbox')).toHaveValue('lo');
    type('');
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(nav.router.replace).toHaveBeenCalledWith('/search', { scroll: false });
  });

  test('Enter searches at once', () => {
    render(<SearchField />);
    type('ambient');
    fireEvent.submit(screen.getByRole('searchbox').closest('form') as HTMLFormElement);
    expect(nav.router.push).toHaveBeenCalledWith('/search?q=ambient');
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(nav.router.push).toHaveBeenCalledOnce();
  });
});
```

`apps/web/components/shell/shell.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { STORAGE_KEY } from '@/lib/player/persistence';
import { noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import { PlayerShortcuts } from './player-shortcuts';
import { Sidebar } from './sidebar';
import { UserMenu } from './user-menu';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, pathname: '/' }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth-client', () => ({ authClient: auth }));

const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const playlist = {
  id: PID,
  name: 'Gym',
  description: null,
  coverUrl: null,
  isPublic: false,
  trackCount: 3,
  covers: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
const artist = { id: 'audius:a1', source: 'audius', name: 'Kaito', avatar: {}, verified: false };

let requests: ReturnType<typeof stubApi>['requests'];

beforeEach(() => {
  player.actions.reset();
  ({ requests } = stubApi({
    'GET /api/me/likes/ids': ['audius:t1', 'audius:t2'],
    'GET /api/me/playlists': [playlist],
    'GET /api/me/following': [artist],
    'POST /api/me/playlists': () =>
      Response.json({ ...playlist, id: 'new-id', name: 'Focus' }, { status: 201 }),
    'GET /api/me': {
      id: 'u1',
      name: 'Ada Byron',
      email: 'ada@example.com',
      image: null,
      createdAt: '',
    },
    'PUT /api/me/likes/audius:t9': noContent,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Sidebar', () => {
  test('lists Liked Songs, playlists and followed artists', async () => {
    const { wrapper } = queryWrapper();
    render(<Sidebar />, { wrapper });
    expect(await screen.findAllByRole('link', { name: /Gym/ })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: /Kaito/ })[0]).toHaveAttribute(
      'href',
      '/artist/audius:a1',
    );
    expect(await screen.findAllByText('Playlist · 2 songs')).not.toHaveLength(0);
  });

  test('creates a playlist and opens it', async () => {
    const { wrapper } = queryWrapper();
    render(<Sidebar />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'New playlist' }));
    await userEvent.type(await screen.findByLabelText('Name'), 'Focus');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith('/playlist/new-id'));
    expect(requests.find((r) => r.method === 'POST')?.body).toEqual({ name: 'Focus' });
  });
});

describe('UserMenu', () => {
  test('signing out stops playback and forgets the saved queue', async () => {
    localStorage.setItem(STORAGE_KEY, '{}');
    act(() => player.actions.playContext([track(1)], 0, { type: 'search', name: 'Search' }));
    const { wrapper } = queryWrapper();
    render(<UserMenu />, { wrapper });
    await userEvent.click(await screen.findByRole('button', { name: 'Account: Ada Byron' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/sign-in'));
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(player.store.getState().queue.current).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('PlayerShortcuts', () => {
  test('L likes the playing track', async () => {
    act(() => player.actions.playContext([track(9)], 0, { type: 'search', name: 'Search' }));
    const { wrapper } = queryWrapper();
    render(<PlayerShortcuts />, { wrapper });
    fireEvent.keyDown(window, { key: 'l' });
    await waitFor(() =>
      expect(requests.some((r) => r.method === 'PUT' && r.path === '/api/me/likes/audius:t9')).toBe(
        true,
      ),
    );
  });

  test('/ focuses the search box, or opens search when there is none', () => {
    const { wrapper } = queryWrapper();
    const { rerender } = render(<PlayerShortcuts />, { wrapper });
    fireEvent.keyDown(window, { key: '/' });
    expect(nav.router.push).toHaveBeenCalledWith('/search');
    rerender(
      <>
        <PlayerShortcuts />
        <input data-search-input aria-label="Search" />
      </>,
    );
    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
  });
});
```

`apps/web/app/(app)/liked/page.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { apiError, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import LikedPage from './page';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const page = (n: number, nextCursor: string | null) => ({
  items: [{ track: track(n), likedAt: '2026-09-01T00:00:00Z' }],
  nextCursor,
});

beforeEach(() => player.actions.reset());
afterEach(() => vi.unstubAllGlobals());

test('lists liked songs with the total count', async () => {
  stubApi({
    'GET /api/me/likes': page(1, null),
    'GET /api/me/likes/ids': ['audius:t1'],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  expect(await screen.findByRole('button', { name: 'Play Track 1' })).toBeInTheDocument();
  expect(await screen.findByText('1 song')).toBeInTheDocument();
});

test('play fetches every page first, so the queue holds all liked songs', async () => {
  stubApi({
    'GET /api/me/likes': ({ query }) =>
      Response.json(
        query.get('cursor') === 'c2'
          ? page(3, null)
          : query.get('cursor')
            ? page(2, 'c2')
            : page(1, 'c1'),
      ),
    'GET /api/me/likes/ids': ['audius:t1', 'audius:t2', 'audius:t3'],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  await userEvent.click(await screen.findByRole('button', { name: 'Play Liked Songs' }));
  await waitFor(() =>
    expect(player.store.getState().queue.order.map((item) => item.track.id)).toEqual([
      'audius:t1',
      'audius:t2',
      'audius:t3',
    ]),
  );
  expect(player.store.getState().queue.context).toEqual({ type: 'liked', name: 'Liked Songs' });
});

test('an empty library points to search', async () => {
  stubApi({ 'GET /api/me/likes': { items: [], nextCursor: null }, 'GET /api/me/likes/ids': [] });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  expect(await screen.findByRole('link', { name: 'Find something to like' })).toHaveAttribute(
    'href',
    '/search',
  );
});

test('a failure offers a retry', async () => {
  stubApi({
    'GET /api/me/likes': () => apiError(500, 'INTERNAL', 'Something went wrong'),
    'GET /api/me/likes/ids': [],
  });
  const { wrapper } = queryWrapper();
  render(<LikedPage />, { wrapper });
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run components/states components/media components/shell app`
Expected: the five new files FAIL with `Failed to resolve import`. `media.test.tsx` and the route test still pass.

- [ ] **Step 3: Write the page building blocks**

`apps/web/components/providers.tsx`:

```tsx
'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { createQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        theme="dark"
        position="bottom-center"
        offset={{ bottom: 'calc(var(--player-h) + 1rem)' }}
        mobileOffset={{ bottom: 'calc(var(--tabbar-h) + var(--mini-h) + var(--safe-b) + 1rem)' }}
        toastOptions={{ className: '!bg-raised !text-fg !border-line' }}
      />
    </QueryClientProvider>
  );
}
```

`apps/web/components/states/page-state.tsx`:

```tsx
'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/query-client';

/** A page-level failure: Retry for upstream and network errors, a way home for missing pages. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const missing = error instanceof ApiRequestError && error.status === 404;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <p className="font-semibold text-lg">{missing ? 'Not found' : 'Couldn’t load this'}</p>
      <p className="max-w-sm text-muted text-sm">{describeError(error)}</p>
      {missing ? (
        <Button asChild className="mt-2">
          <Link href="/">Go home</Link>
        </Button>
      ) : (
        <Button className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <Icon className="size-10 text-faint" aria-hidden />
      <p className="font-semibold text-lg">{title}</p>
      {children && <p className="max-w-sm text-muted text-sm">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
```

`apps/web/components/media/covers.tsx`:

```tsx
import type { PlaylistSummary } from '@riff/api';
import { Heart, ListMusic } from 'lucide-react';
import { cn } from '@/lib/cn';

/** The Liked Songs tile. */
export function LikedCover({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'grid aspect-square place-items-center rounded-md bg-linear-to-br from-accent to-[oklch(0.45_0.14_25)]',
        className,
      )}
    >
      <Heart className="size-2/5 fill-on-accent text-on-accent" aria-hidden />
    </div>
  );
}

/** A playlist's cover: its own image, else a 2×2 mosaic of its first artworks. */
export function PlaylistCover({
  playlist,
  className,
}: {
  playlist: Pick<PlaylistSummary, 'coverUrl' | 'covers'>;
  className?: string;
}) {
  const base = cn('aspect-square overflow-hidden rounded-md bg-raised', className);
  const images = playlist.coverUrl ? [playlist.coverUrl] : playlist.covers;
  if (images.length === 0) {
    return (
      <div className={cn(base, 'grid place-items-center text-faint')}>
        <ListMusic className="size-2/5" aria-hidden />
      </div>
    );
  }
  const tiles = images.length >= 4 ? images.slice(0, 4) : images.slice(0, 1);
  return (
    <div className={cn(base, tiles.length === 4 && 'grid grid-cols-2')}>
      {tiles.map((src, index) => (
        <img
          // Covers can repeat when a playlist holds the same track twice.
          key={index}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ))}
    </div>
  );
}
```

`apps/web/components/media/page-header.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { backdrop } from '@/components/player/now-playing';
import { Skeleton } from '@/components/ui/skeleton';
import { useDominantColor } from '@/lib/use-dominant-color';

interface PageHeaderProps {
  /** Small label above the title, e.g. "Playlist" or "Album". */
  kind: ReactNode;
  title: ReactNode;
  cover: ReactNode;
  /** Artwork to tint the header with. */
  tintFrom?: string;
  meta?: ReactNode;
  children?: ReactNode;
}

/** The header of a list page: cover, kind, title, details, then its actions. */
export function PageHeader({ kind, title, cover, tintFrom, meta, children }: PageHeaderProps) {
  const color = useDominantColor(tintFrom);
  return (
    <div style={backdrop(color)} className="-mt-16 pt-16">
      <header className="flex flex-col gap-5 px-4 pt-4 pb-6 md:flex-row md:items-end md:px-8 md:pt-8">
        <div className="w-40 shrink-0 self-center shadow-2xl shadow-black/50 md:w-52 md:self-auto">
          {cover}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="font-medium text-muted text-sm">{kind}</p>
          <h1 className="break-words font-bold text-3xl tracking-tight md:text-5xl">{title}</h1>
          {meta && <div className="text-muted text-sm">{meta}</div>}
        </div>
      </header>
      {children && <div className="flex items-center gap-2 px-4 pb-4 md:px-8">{children}</div>}
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col gap-5 px-4 pt-4 pb-6 md:flex-row md:items-end md:px-8 md:pt-8"
    >
      <Skeleton className="size-40 self-center md:size-52 md:self-auto" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-40" />
      </div>
    </div>
  );
}
```

`apps/web/components/tracks/play-context-button.tsx`:

```tsx
'use client';

import type { QueueContext, Track } from '@riff/core';
import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { player, usePlayer } from '@/lib/player/instance';

export const sameContext = (a: QueueContext | null, b: QueueContext) =>
  a !== null && a.type === b.type && a.id === b.id;

interface PlayContextButtonProps {
  tracks: readonly Track[];
  context: QueueContext;
  /** Loads the full list first (e.g. every page of Liked Songs). */
  loadAll?: () => Promise<readonly Track[]>;
}

/** The big play button of a list page: plays it from the top, or pauses/resumes it. */
export function PlayContextButton({ tracks, context, loadAll }: PlayContextButtonProps) {
  const { isThis, active } = usePlayer(
    useShallow((s) => ({
      isThis: sameContext(s.queue.context, context),
      active: s.status === 'playing' || s.status === 'loading',
    })),
  );
  const [loading, setLoading] = useState(false);
  const pausing = isThis && active;

  async function onClick() {
    if (isThis) {
      player.actions.togglePlay();
      return;
    }
    let list = tracks;
    if (loadAll) {
      setLoading(true);
      try {
        list = await loadAll();
      } finally {
        setLoading(false);
      }
    }
    player.actions.playContext(list, 0, context);
  }

  return (
    <Button
      variant="primary"
      size="icon"
      className="size-14 shadow-accent/20 shadow-lg [&_svg]:size-6"
      aria-label={pausing ? `Pause ${context.name}` : `Play ${context.name}`}
      disabled={tracks.length === 0 || loading}
      onClick={onClick}
    >
      {pausing ? (
        <Pause className="fill-current" />
      ) : (
        <Play className="translate-x-0.5 fill-current" />
      )}
    </Button>
  );
}
```

- [ ] **Step 4: Write the shell**

The page scrolls with the window; the sidebar, panel, player bar, mini-player and tab bar are fixed. `<main>` reserves room for them through the CSS variables that `AppShell` sets. The tablet rail and a collapsed desktop sidebar are pure CSS, so server and client render the same markup.

`apps/web/components/shell/create-playlist-dialog.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useCreatePlaylist } from '@/lib/queries/playlists';

/** Wraps a trigger button; creating a playlist opens it. */
export function CreatePlaylistDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const create = useCreatePlaylist();
  const router = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    if (!name) return;
    create.mutate(
      { name },
      {
        onSuccess: (playlist) => {
          setOpen(false);
          router.push(`/playlist/${playlist.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="New playlist">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="playlist-name">Name</Label>
            <Input id="playlist-name" name="name" required maxLength={100} autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/components/shell/library-list.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Artwork } from '@/components/media/artwork';
import { LikedCover, PlaylistCover } from '@/components/media/covers';
import { cn } from '@/lib/cn';
import { useFollowing, useLikedIds } from '@/lib/queries/library';
import { usePlaylists } from '@/lib/queries/playlists';

function LibraryLink({
  href,
  cover,
  title,
  subtitle,
  compact,
}: {
  href: string;
  cover: ReactNode;
  title: string;
  subtitle: string;
  compact: boolean;
}) {
  const active = usePathname() === href;
  return (
    <li>
      <Link
        href={href}
        title={compact ? title : undefined}
        aria-label={compact ? title : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg p-1.5 hover:bg-raised',
          active && 'bg-raised',
          compact && 'justify-center',
        )}
      >
        <span className="size-11 shrink-0">{cover}</span>
        {!compact && (
          <span className="min-w-0">
            <span className={cn('block truncate text-sm', active && 'text-accent')}>{title}</span>
            <span className="block truncate text-muted text-xs">{subtitle}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** Liked Songs, the user's playlists and followed artists. */
export function LibraryList({ compact = false }: { compact?: boolean }) {
  const liked = useLikedIds();
  const playlists = usePlaylists();
  const following = useFollowing();
  return (
    <ul aria-label="Your library" className="flex flex-col gap-0.5">
      <LibraryLink
        href="/liked"
        cover={<LikedCover className="size-11" />}
        title="Liked Songs"
        subtitle={`Playlist · ${liked.size} ${liked.size === 1 ? 'song' : 'songs'}`}
        compact={compact}
      />
      {playlists.data?.map((playlist) => (
        <LibraryLink
          key={playlist.id}
          href={`/playlist/${playlist.id}`}
          cover={<PlaylistCover playlist={playlist} className="size-11" />}
          title={playlist.name}
          subtitle={`Playlist · ${playlist.trackCount} ${playlist.trackCount === 1 ? 'track' : 'tracks'}`}
          compact={compact}
        />
      ))}
      {following.data?.map((artist) => (
        <LibraryLink
          key={artist.id}
          href={`/artist/${artist.id}`}
          cover={<Artwork artwork={artist.avatar} size="sm" className="size-11 rounded-full" />}
          title={artist.name}
          subtitle="Artist"
          compact={compact}
        />
      ))}
    </ul>
  );
}
```

`apps/web/components/shell/sidebar.tsx`:

```tsx
'use client';

import {
  House,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ui, useUi } from '@/lib/ui-store';
import { CreatePlaylistDialog } from './create-playlist-dialog';
import { LibraryList } from './library-list';

export const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: House },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/radio', label: 'Radio', icon: Radio },
];

export const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

/** Desktop and tablet navigation. Tablets and a collapsed desktop sidebar show icons only. */
export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  // Labels show on desktop (lg) unless collapsed; tablets always get the compact rail.
  const label = cn('hidden truncate', !collapsed && 'lg:inline');
  return (
    <aside
      aria-label="Sidebar"
      className="fixed top-0 bottom-[var(--player-h)] left-0 z-20 hidden w-[var(--sidebar-w)] flex-col gap-2 p-2 md:flex"
    >
      <div className="flex flex-col gap-1 rounded-xl bg-surface p-2">
        <div className="flex h-10 items-center justify-between px-2">
          <Link href="/" aria-label="Riff home" className="rounded-md">
            <Logo className="text-lg" labelClassName={label} />
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('hidden', !collapsed && 'lg:inline-flex')}
            aria-label="Collapse sidebar"
            onClick={ui.toggleSidebar}
          >
            <PanelLeftClose />
          </Button>
        </div>
        {collapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="mx-auto hidden lg:inline-flex"
            aria-label="Expand sidebar"
            onClick={ui.toggleSidebar}
          >
            <PanelLeftOpen />
          </Button>
        )}
        <nav aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {NAV.map(({ href, label: text, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    title={text}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-10 items-center justify-center gap-3 rounded-lg px-3 font-medium text-muted text-sm hover:text-fg',
                      !collapsed && 'lg:justify-start',
                      active && 'text-fg',
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden />
                    <span className={label}>{text}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <section
        aria-labelledby="library-heading"
        className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl bg-surface p-2"
      >
        <div
          className={cn(
            'flex h-10 items-center justify-center gap-2 px-2',
            !collapsed && 'lg:justify-between',
          )}
        >
          <h2 id="library-heading" className={cn(label, 'font-semibold text-sm')}>
            Library
          </h2>
          <CreatePlaylistDialog>
            <Button variant="ghost" size="icon-sm" aria-label="New playlist">
              <Plus />
            </Button>
          </CreatePlaylistDialog>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(!collapsed && 'lg:hidden')}>
            <LibraryList compact />
          </div>
          <div className={cn('hidden', !collapsed && 'lg:block')}>
            <LibraryList />
          </div>
        </div>
      </section>
    </aside>
  );
}
```

`apps/web/components/shell/search-field.tsx`:

```tsx
'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export const SEARCH_DEBOUNCE_MS = 250;

/**
 * The search box. Typing updates /search?q= (replacing history entries while on the search
 * page, so Back leaves search instead of stepping through keystrokes).
 */
export function SearchField({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const onSearchPage = pathname === '/search';
  const urlQuery = onSearchPage ? (params.get('q') ?? '') : '';
  const [value, setValue] = useState(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow the URL when it changes from elsewhere (Back, a genre link, leaving the page).
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const navigate = (text: string) => {
    const q = text.trim();
    const href = q ? `/search?q=${encodeURIComponent(q)}` : '/search';
    if (onSearchPage) router.replace(href, { scroll: false });
    else router.push(href);
  };

  return (
    <search className={cn('relative block w-full max-w-md', className)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          clearTimeout(timer.current);
          navigate(value);
        }}
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          type="search"
          data-search-input
          aria-label="Search"
          placeholder="Search tracks, artists, radio"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => navigate(next), SEARCH_DEBOUNCE_MS);
          }}
          className="h-11 w-full rounded-full border border-line bg-surface pr-4 pl-10 text-sm outline-none transition-colors placeholder:text-faint hover:border-faint focus-visible:border-accent focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
      </form>
    </search>
  );
}
```

`apps/web/components/shell/user-menu.tsx`:

```tsx
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { authClient } from '@/lib/auth-client';
import { player } from '@/lib/player/instance';
import { clearSavedPlayer } from '@/lib/player/persistence';
import { useMe } from '@/lib/queries/library';

export function UserMenu() {
  const me = useMe();
  const client = useQueryClient();
  const router = useRouter();
  const initial = me.data?.name.trim().charAt(0).toUpperCase() || '?';

  async function signOut() {
    await authClient.signOut().catch(() => {
      // Signing out of an expired session fails; the local cleanup below still applies.
    });
    player.actions.reset();
    try {
      clearSavedPlayer(window.localStorage);
    } catch {
      // Storage unavailable: nothing was saved.
    }
    client.clear();
    router.replace('/sign-in');
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="size-9 font-semibold text-sm"
          aria-label={me.data ? `Account: ${me.data.name}` : 'Account'}
        >
          {initial}
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="w-60">
        {me.data && (
          <MenuLabel>
            <span className="block truncate font-medium text-fg text-sm">{me.data.name}</span>
            <span className="block truncate">{me.data.email}</span>
          </MenuLabel>
        )}
        <MenuSeparator />
        <MenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
```

`apps/web/components/shell/top-bar.tsx`:

```tsx
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { SearchField } from './search-field';
import { UserMenu } from './user-menu';

export function TopBar() {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-2 bg-bg/85 px-4 backdrop-blur-md md:px-6">
      <Link href="/" aria-label="Riff home" className="rounded-md md:hidden">
        <Logo className="text-lg" />
      </Link>
      <div className="hidden items-center gap-1 md:flex">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.back()}>
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Forward"
          onClick={() => router.forward()}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="hidden flex-1 md:block">
        <Suspense>
          <SearchField />
        </Suspense>
      </div>
      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  );
}
```

`apps/web/components/shell/mobile-tab-bar.tsx`:

```tsx
'use client';

import { House, Library, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { isActive } from './sidebar';

const TABS = [
  { href: '/', label: 'Home', icon: House },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/library', label: 'Library', icon: Library },
];

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(var(--tabbar-h)+var(--safe-b))] grid-cols-3 border-line border-t bg-surface/95 pb-[var(--safe-b)] backdrop-blur-md md:hidden"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center justify-center gap-1 font-medium text-[11px] text-muted',
              active && 'text-fg',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

`apps/web/components/shell/right-panel.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import { LyricsPanel } from '@/components/player/lyrics-panel';
import { NowPlayingPanel } from '@/components/player/now-playing';
import { QueuePanel } from '@/components/player/queue-panel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type PanelTab, ui, useUi } from '@/lib/ui-store';

/**
 * Queue, lyrics and Now Playing. Beside the page on desktop; over it on tablets, where the
 * page has no room to give up.
 */
export function RightPanel() {
  const panel = useUi((s) => s.panel);
  if (!panel) return null;
  return (
    <aside
      aria-label="Player panel"
      className="fixed top-0 right-0 bottom-[var(--player-h)] z-20 hidden w-[21rem] flex-col border-line border-l bg-surface shadow-2xl shadow-black/40 md:flex lg:shadow-none"
    >
      <Tabs
        value={panel}
        onValueChange={(tab) => ui.showPanel(tab as PanelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-line border-b px-3">
          <TabsList aria-label="Panel" className="flex-1">
            <TabsTrigger value="queue">Queue</TabsTrigger>
            <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
            <TabsTrigger value="nowPlaying">Now playing</TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={() => ui.showPanel(null)}
          >
            <X />
          </Button>
        </div>
        <TabsContent value="queue" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <QueuePanel />
        </TabsContent>
        <TabsContent value="lyrics" className="min-h-0 flex-1 px-4">
          <LyricsPanel className="h-full" />
        </TabsContent>
        <TabsContent value="nowPlaying" className="min-h-0 flex-1 overflow-y-auto px-4">
          <NowPlayingPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
```

`apps/web/components/player/player-bar.tsx`:

```tsx
'use client';

import { ListMusic, type LucideIcon, MicVocal, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { type PanelTab, ui, useUi } from '@/lib/ui-store';
import { NowPlayingInfo } from './now-playing-info';
import { SeekBar } from './seek-bar';
import { Transport } from './transport';
import { VolumeControl } from './volume-control';

const PANEL_BUTTONS: { tab: PanelTab; label: string; icon: LucideIcon }[] = [
  { tab: 'nowPlaying', label: 'Now playing', icon: PanelRight },
  { tab: 'lyrics', label: 'Lyrics', icon: MicVocal },
  { tab: 'queue', label: 'Queue', icon: ListMusic },
];

/** The desktop and tablet player bar. */
export function PlayerBar() {
  const panel = useUi((s) => s.panel);
  return (
    <section
      aria-label="Player"
      className="fixed inset-x-0 bottom-0 z-30 hidden h-[var(--player-h)] grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4 border-line border-t bg-surface px-4 md:grid"
    >
      <NowPlayingInfo />
      <div className="flex flex-col items-center gap-1">
        <Transport />
        <SeekBar className="max-w-xl" />
      </div>
      <div className="flex items-center justify-end gap-1">
        {PANEL_BUTTONS.map(({ tab, label, icon: Icon }) => (
          <Button
            key={tab}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={panel === tab}
            className={cn(panel === tab && 'text-accent hover:text-accent')}
            onClick={() => ui.togglePanel(tab)}
          >
            <Icon />
          </Button>
        ))}
        <div className="hidden lg:block">
          <VolumeControl />
        </div>
      </div>
    </section>
  );
}
```

`apps/web/components/player/mini-player.tsx`:

```tsx
'use client';

import { useShallow } from 'zustand/react/shallow';
import { Artwork } from '@/components/media/artwork';
import { LikeButton } from '@/components/tracks/like-button';
import { artistNames } from '@/lib/format';
import { usePlayer } from '@/lib/player/instance';
import { ui } from '@/lib/ui-store';
import { PlayButton } from './transport';

/** The phone's compact player above the tab bar; tapping it opens Now Playing. */
export function MiniPlayer() {
  const { track, progress } = usePlayer(
    useShallow((s) => ({
      track: s.queue.current?.track ?? null,
      progress: s.duration ? Math.min(s.position / s.duration, 1) : 0,
    })),
  );
  if (!track) return null;
  return (
    <div className="fixed inset-x-2 bottom-[calc(var(--tabbar-h)+var(--safe-b)+0.375rem)] z-30 flex h-[calc(var(--mini-h)-0.75rem)] items-center gap-2 overflow-hidden rounded-xl bg-raised pr-2 shadow-black/50 shadow-lg md:hidden">
      <button
        type="button"
        onClick={() => ui.setNowPlayingOpen(true)}
        aria-label={`Open Now Playing: ${track.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch pl-2 text-left"
      >
        <Artwork artwork={track.artwork} size="sm" className="size-10 shrink-0 rounded" />
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">{track.title}</span>
          <span className="block truncate text-muted text-xs">
            {artistNames(track.artists) || 'Live radio'}
          </span>
        </span>
      </button>
      <LikeButton track={track} />
      <PlayButton className="size-9" />
      <div aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-line">
        <div className="h-full rounded-full bg-fg" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
```

`apps/web/components/shell/player-shortcuts.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { player } from '@/lib/player/instance';
import { SEEK_STEP_SEC, useShortcuts } from '@/lib/player/shortcuts';
import { useLikedIds, useToggleLike } from '@/lib/queries/library';

/** The first search box actually on screen (the phone and desktop layouts each have one). */
function visibleSearchInput(): HTMLInputElement | null {
  const inputs = document.querySelectorAll<HTMLInputElement>('[data-search-input]');
  return [...inputs].find((input) => input.checkVisibility?.() ?? true) ?? null;
}

/** Binds the keyboard shortcuts (see lib/player/shortcuts.ts) for the whole app. */
export function PlayerShortcuts() {
  const router = useRouter();
  const liked = useLikedIds();
  const toggleLike = useToggleLike();
  const { actions, store } = player;
  useShortcuts({
    togglePlay: () => actions.togglePlay(),
    seekBack: () => actions.seek(store.getState().position - SEEK_STEP_SEC),
    seekForward: () => actions.seek(store.getState().position + SEEK_STEP_SEC),
    prev: () => actions.prev(),
    next: () => actions.next(),
    toggleMute: () => actions.toggleMute(),
    like: () => {
      const track = store.getState().queue.current?.track;
      if (track && !track.isLive) toggleLike.mutate({ track, like: !liked.has(track.id) });
    },
    focusSearch: () => {
      const input = visibleSearchInput();
      if (input) input.focus();
      else router.push('/search');
    },
  });
  return null;
}
```

`apps/web/components/shell/app-shell.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { MiniPlayer } from '@/components/player/mini-player';
import { NowPlayingSheet } from '@/components/player/now-playing';
import { PlayerBar } from '@/components/player/player-bar';
import { cn } from '@/lib/cn';
import { usePlayer } from '@/lib/player/instance';
import { useUi } from '@/lib/ui-store';
import { MobileTabBar } from './mobile-tab-bar';
import { RightPanel } from './right-panel';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

/**
 * Layout: sidebar | page | optional panel, over the player bar (desktop and tablet); page over
 * mini-player and tab bar (phone). The page scrolls with the window; the rest is fixed.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const panelOpen = useUi((s) => s.panel !== null);
  const hasTrack = usePlayer((s) => s.queue.current !== null);
  return (
    <div
      data-collapsed={collapsed || undefined}
      data-panel={panelOpen || undefined}
      className="min-h-dvh [--panel-w:0px] [--sidebar-w:0px] md:[--sidebar-w:5rem] lg:[--sidebar-w:18rem] lg:data-collapsed:[--sidebar-w:5rem] lg:data-panel:[--panel-w:21rem]"
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-fg focus:px-4 focus:py-2 focus:text-bg"
      >
        Skip to content
      </a>
      <Sidebar />
      <main
        id="main"
        className={cn(
          'min-h-dvh pr-[var(--panel-w)] pl-[var(--sidebar-w)] md:pb-[var(--player-h)]',
          hasTrack
            ? 'pb-[calc(var(--tabbar-h)+var(--mini-h)+var(--safe-b))]'
            : 'pb-[calc(var(--tabbar-h)+var(--safe-b))]',
        )}
      >
        <TopBar />
        {children}
      </main>
      <RightPanel />
      <PlayerBar />
      <MiniPlayer />
      <MobileTabBar />
      <NowPlayingSheet />
    </div>
  );
}
```

- [ ] **Step 5: Add the app layout and Liked Songs**

Liked Songs pages in 50 at a time. Play loads every remaining page first, so the queue holds every liked song.

`apps/web/app/(app)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { PlayerRuntime } from '@/components/player/player-runtime';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/shell/app-shell';
import { PlayerShortcuts } from '@/components/shell/player-shortcuts';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <PlayerRuntime />
      <PlayerShortcuts />
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
```

`apps/web/app/(app)/liked/page.tsx`:

```tsx
'use client';

import type { QueueContext, Track } from '@riff/core';
import { Heart } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { LikedCover } from '@/components/media/covers';
import { PageHeader } from '@/components/media/page-header';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { Button } from '@/components/ui/button';
import { useLikedIds, useLikes } from '@/lib/queries/library';

const CONTEXT: QueueContext = { type: 'liked', name: 'Liked Songs' };

export default function LikedPage() {
  const likes = useLikes();
  const count = useLikedIds().size;
  const tracks = useMemo(
    () => likes.data?.pages.flatMap((page) => page.items.map((item) => item.track)) ?? [],
    [likes.data],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = likes;
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** Every liked track, fetching the remaining pages first, so "play" covers them all. */
  const loadAll = useCallback(async (): Promise<Track[]> => {
    let result: Pick<typeof likes, 'data' | 'hasNextPage' | 'fetchNextPage'> = likes;
    while (result.hasNextPage) result = await result.fetchNextPage();
    return result.data?.pages.flatMap((page) => page.items.map((item) => item.track)) ?? [];
  }, [likes]);

  return (
    <>
      <PageHeader
        kind="Playlist"
        title="Liked Songs"
        cover={<LikedCover className="w-full" />}
        meta={`${count} ${count === 1 ? 'song' : 'songs'}`}
      >
        <PlayContextButton tracks={tracks} context={CONTEXT} loadAll={loadAll} />
      </PageHeader>
      <section className="px-2 md:px-6">
        {likes.isPending ? (
          <TrackListSkeleton />
        ) : likes.isError ? (
          <ErrorState error={likes.error} onRetry={() => likes.refetch()} />
        ) : tracks.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Songs you like will appear here"
            action={
              <Button asChild variant="primary">
                <Link href="/search">Find something to like</Link>
              </Button>
            }
          >
            Tap the heart on any track to save it.
          </EmptyState>
        ) : (
          <TrackList tracks={tracks} context={CONTEXT} showAlbum onEndReached={onEndReached} />
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 6: Run the tests, then look at it**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck`
Expected: `Tests  220 passed (220)`: 202 plus page states 3, covers 3, search field 3, shell 5, Liked Songs 4. No type errors.

Then run `pnpm dev`, sign in, and open `/liked` at desktop width. Expected:
- the sidebar (Home, Search, Radio; Library with Liked Songs)
- the top bar (Back, Forward, search, account)
- the Liked Songs header with its gradient tile and play button
- the "Songs you like will appear here" empty state
- the player bar reading "Pick something to play"

`/` still 404s until Task 12.

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add the app shell and the Liked Songs page"
```

### Task 12: Home, Search, Genre, Artist, Collection, Radio and Library

**Files:**
- Create:
  - `apps/web/components/media/{shelf,cards,source-notice,genre-grid}.tsx`
  - `apps/web/lib/route-param.ts`
  - `apps/web/app/(app)/page.tsx`
  - `apps/web/app/(app)/{search,genre/[genre],artist/[id],collection/[id],radio,library}/page.tsx`
- Test: `apps/web/components/media/source-notice.test.tsx`, `apps/web/lib/route-param.test.ts`, `apps/web/app/(app)/pages.test.tsx`

**Interfaces:**
- Consumes: the catalog and library hooks (Task 7), `TrackList` (Task 10), and the shell building blocks (Task 11).
- Produces:
  - Shelves and cards:
    - `<Shelf title href?>`, a sideways-scrolling row, and `<ShelfSkeleton>`.
    - `<TrackCard tracks index context layout?="shelf"|"grid">`: stations fit their logo inside the tile.
    - `<ArtistCard artist>` and `<CollectionCard collection>`.
  - `<SourceNotice sources>`: names sources that errored or timed out; `disabled` counts as neither.
  - `<GenreGrid>` and `genreHref(genre)`.
  - `decodeSegment(segment)` (a stray `%` stays as-is) and `useRouteParam(name)`.
  - The routes `/`, `/search`, `/genre/[genre]`, `/artist/[id]`, `/collection/[id]`, `/radio` and `/library`.

- [ ] **Step 1: Write the failing tests**

`apps/web/components/media/source-notice.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SourceNotice } from './source-notice';

test('names the sources that failed or timed out', () => {
  render(<SourceNotice sources={{ audius: 'ok', jamendo: 'timeout', radio: 'error' }} />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Jamendo and Radio Browser are unavailable right now',
  );
});

test('says nothing when every source answered or is switched off', () => {
  const { container } = render(
    <SourceNotice sources={{ audius: 'ok', jamendo: 'disabled', radio: 'ok' }} />,
  );
  expect(container).toBeEmptyDOMElement();
});
```

`apps/web/lib/route-param.test.ts`:

```ts
import { expect, test } from 'vitest';
import { decodeSegment } from './route-param';

test.each([
  ['Hip-Hop%2FRap', 'Hip-Hop/Rap'],
  ['audius%3AnD96J', 'audius:nD96J'],
  ['audius:nD96J', 'audius:nD96J'],
  ['100%', '100%'],
  ['%E0%A4%A', '%E0%A4%A'],
])('decodeSegment(%j) is %j', (segment, expected) => {
  expect(decodeSegment(segment)).toBe(expected);
});
```

`apps/web/app/(app)/pages.test.tsx`:

```tsx
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiError, noContent, stubApi } from '@/test/api-stub';
import { station, track, tracks } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import ArtistPage from './artist/[id]/page';
import CollectionPage from './collection/[id]/page';
import GenrePage from './genre/[genre]/page';
import HomePage from './page';
import RadioPage from './radio/page';
import SearchPage from './search/page';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const nav = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  search: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useSearchParams: () => nav.search,
  useRouter: () => nav.router,
  usePathname: () => '/search',
}));

const ok = { audius: 'ok', jamendo: 'disabled', radio: 'ok' };
const emptyHome = { recentlyPlayed: [], topGenres: [], fromFollowed: [], trending: [] };
const artist = {
  id: 'audius:a1',
  source: 'audius',
  name: 'Kaito',
  avatar: {},
  verified: true,
  followerCount: 1234,
  bio: 'Makes music at night.',
};

beforeEach(() => {
  player.actions.reset();
  nav.params = {};
  nav.search = new URLSearchParams();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderPage(page: React.ReactElement) {
  const { wrapper } = queryWrapper();
  return render(page, { wrapper });
}

describe('Home', () => {
  test('shows only the sections that have tracks', async () => {
    stubApi({
      'GET /api/home': {
        ...emptyHome,
        topGenres: [{ genre: 'Lo-Fi', tracks: tracks(2) }],
        trending: [track(5)],
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Trending in Lo-Fi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/genre/Lo-Fi');
    expect(screen.getByRole('heading', { name: 'Trending this week' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recently played' })).not.toBeInTheDocument();
  });

  test('a card plays its shelf from that track', async () => {
    stubApi({
      'GET /api/home': { ...emptyHome, recentlyPlayed: tracks(3) },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<HomePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Play Track 2' }));
    expect(player.store.getState().queue.current?.track.id).toBe('audius:t2');
    expect(player.store.getState().queue.context?.type).toBe('history');
  });

  test('a failure offers a retry', async () => {
    stubApi({ 'GET /api/home': () => apiError(500, 'INTERNAL', 'Something went wrong') });
    renderPage(<HomePage />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Search', () => {
  test('with no query, shows the genre grid', () => {
    stubApi({});
    renderPage(<SearchPage />);
    expect(screen.getByRole('heading', { name: 'Browse genres' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hip-Hop/Rap' })).toHaveAttribute(
      'href',
      '/genre/Hip-Hop%2FRap',
    );
  });

  test('shows results by kind and names a failed source', async () => {
    nav.search = new URLSearchParams('q=night');
    stubApi({
      'GET /api/search': {
        tracks: [track(1)],
        artists: [artist],
        collections: [],
        stations: [station(1)],
        sources: { audius: 'ok', jamendo: 'error', radio: 'ok' },
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<SearchPage />);
    expect(await screen.findByRole('heading', { name: 'Tracks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Artists' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Radio stations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Albums and playlists' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Jamendo is unavailable');
  });

  test('says when nothing matched', async () => {
    nav.search = new URLSearchParams('q=zzqx');
    stubApi({
      'GET /api/search': { tracks: [], artists: [], collections: [], stations: [], sources: ok },
    });
    renderPage(<SearchPage />);
    expect(await screen.findByText('No results for “zzqx”')).toBeInTheDocument();
  });
});

describe('Genre', () => {
  test('switches the trending period', async () => {
    nav.params = { genre: 'Hip-Hop%2FRap' };
    const { requests } = stubApi({
      'GET /api/trending': { tracks: [track(1)], sources: ok },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<GenrePage />);
    expect(screen.getByRole('heading', { name: 'Hip-Hop/Rap' })).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Play Track 1' });
    await userEvent.click(screen.getByRole('tab', { name: 'All time' }));
    await screen.findByRole('button', { name: 'Play Track 1' });
    const trending = requests.filter((r) => r.path === '/api/trending');
    expect(trending.map((r) => r.query.get('window'))).toEqual(['week', 'allTime']);
    expect(trending.every((r) => r.query.get('genre') === 'Hip-Hop/Rap')).toBe(true);
  });
});

describe('Artist', () => {
  test('shows the artist and follows them', async () => {
    nav.params = { id: 'audius:a1' };
    const following: unknown[] = [];
    const { requests } = stubApi({
      'GET /api/artists/audius:a1': artist,
      'GET /api/artists/audius:a1/tracks': tracks(2),
      'GET /api/artists/audius:a1/related': [],
      'GET /api/me/following': () => Response.json(following),
      'PUT /api/me/following/audius:a1': () => {
        following.push(artist);
        return noContent();
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<ArtistPage />);
    expect(await screen.findByRole('heading', { name: 'Kaito' })).toBeInTheDocument();
    expect(screen.getByText('1.2K followers')).toBeInTheDocument();
    expect(screen.getByText('Makes music at night.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Follow' }));
    expect(await screen.findByRole('button', { name: 'Following' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(requests.some((r) => r.method === 'PUT')).toBe(true);
  });

  test('an unknown artist is a not-found page', async () => {
    nav.params = { id: 'audius:nope' };
    stubApi({
      'GET /api/artists/audius:nope': () => apiError(404, 'NOT_FOUND', 'No such artist'),
      'GET /api/artists/audius:nope/tracks': () => apiError(404, 'NOT_FOUND', 'No such artist'),
      'GET /api/artists/audius:nope/related': () => apiError(404, 'NOT_FOUND', 'No such artist'),
      'GET /api/me/following': [],
    });
    renderPage(<ArtistPage />);
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});

describe('Collection', () => {
  test('credits the owner and plays the collection', async () => {
    nav.params = { id: 'audius:album:7' };
    stubApi({
      'GET /api/collections/audius:album:7': {
        id: 'audius:album:7',
        source: 'audius',
        kind: 'album',
        title: 'Night Shift',
        artwork: {},
        owner: { id: 'audius:a1', name: 'Kaito' },
        tracks: tracks(2),
      },
      'GET /api/me/likes/ids': [],
    });
    renderPage(<CollectionPage />);
    expect(await screen.findByRole('heading', { name: 'Night Shift' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kaito' })).toHaveAttribute(
      'href',
      '/artist/audius:a1',
    );
    expect(screen.getByText(/2 tracks, 6:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Play Night Shift' }));
    expect(player.store.getState().queue.context).toEqual({
      type: 'collection',
      id: 'audius:album:7',
      name: 'Night Shift',
    });
  });
});

describe('Radio', () => {
  test('lists popular stations, and searches by name', async () => {
    const { requests } = stubApi({
      'GET /api/radio/top': [station(1)],
      'GET /api/radio/search': [station(2)],
    });
    renderPage(<RadioPage />);
    const grid = await screen.findByRole('list');
    expect(within(grid).getByText('Station 1')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search stations' }), 'jazz');
    expect(await screen.findByText('Station 2')).toBeInTheDocument();
    expect(requests.find((r) => r.path === '/api/radio/search')?.query.get('q')).toBe('jazz');
  });

  test('plays a station', async () => {
    stubApi({ 'GET /api/radio/top': [station(1), station(2)] });
    renderPage(<RadioPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Play Station 2' }));
    act(() => undefined);
    expect(player.store.getState().queue.current?.track.isLive).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @riff/web exec vitest run components/media/source-notice lib/route-param app`
Expected: the three new files FAIL with `Failed to resolve import`.

- [ ] **Step 3: Write the shelves, cards and helpers**

`apps/web/components/media/shelf.tsx`:

```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** A titled row of cards that scrolls sideways (snapping) on narrow screens. */
export function Shelf({
  title,
  href,
  children,
}: {
  title: string;
  /** "Show all" destination. */
  href?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4 px-4 md:px-8">
        <h2 className="font-semibold text-xl tracking-tight">{title}</h2>
        {href && (
          <Link
            href={href}
            className="shrink-0 font-medium text-muted text-sm hover:text-fg hover:underline"
          >
            Show all
          </Link>
        )}
      </div>
      <ul className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:scroll-px-8 md:gap-4 md:px-8 [&::-webkit-scrollbar]:hidden">
        {children}
      </ul>
    </section>
  );
}

export function ShelfSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="mx-4 h-6 w-48 md:mx-8" />
      <div className="flex gap-4 overflow-hidden px-4 md:px-8">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex w-36 shrink-0 flex-col gap-2 md:w-44">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

`apps/web/components/media/cards.tsx`:

```tsx
'use client';

import type { Artist, Collection, QueueContext, Track } from '@riff/core';
import { BadgeCheck, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/cn';
import { artistNames } from '@/lib/format';
import { player, usePlayer } from '@/lib/player/instance';
import { Artwork } from './artwork';

const CARD =
  'group relative flex shrink-0 snap-start flex-col gap-2 rounded-xl p-2 hover:bg-raised';
/** Shelf cards have a fixed width; grid cards fill their cell. */
const WIDTH = { shelf: 'w-36 md:w-44', grid: 'w-full min-w-0' } as const;

/** A track in a shelf. The whole card plays `tracks` from this one (a stretched button). */
export function TrackCard({
  tracks,
  index,
  context,
  layout = 'shelf',
}: {
  tracks: readonly Track[];
  index: number;
  context: QueueContext;
  layout?: keyof typeof WIDTH;
}) {
  const track = tracks[index] as Track;
  const { isCurrent, active } = usePlayer(
    useShallow((s) => ({
      isCurrent: s.queue.current?.track.id === track.id,
      active: s.status === 'playing' || s.status === 'loading',
    })),
  );
  const pausing = isCurrent && active;
  return (
    <li className={cn(CARD, WIDTH[layout])}>
      <div className="relative">
        <Artwork
          artwork={track.artwork}
          size="md"
          // Station logos are small favicons: fit them inside the tile rather than crop.
          className={cn('w-full rounded-md', track.isLive && 'object-contain p-5')}
        />
        <span
          aria-hidden
          className={cn(
            'absolute right-2 bottom-2 grid size-11 place-items-center rounded-full bg-accent text-on-accent shadow-black/40 shadow-lg transition-[opacity,transform] motion-safe:translate-y-1 group-hover:translate-y-0 group-hover:opacity-100',
            pausing ? 'translate-y-0 opacity-100' : 'opacity-0',
          )}
        >
          {pausing ? (
            <Pause className="size-5 fill-current" />
          ) : (
            <Play className="size-5 translate-x-px fill-current" />
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={() =>
          isCurrent
            ? player.actions.togglePlay()
            : player.actions.playContext(tracks, index, context)
        }
        aria-label={pausing ? `Pause ${track.title}` : `Play ${track.title}`}
        className={cn(
          'truncate text-left font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent',
          isCurrent && 'text-accent',
        )}
      >
        {track.title}
      </button>
      <p className="-mt-1.5 truncate text-muted text-xs">
        {track.isLive ? (track.genre ?? 'Live radio') : artistNames(track.artists)}
      </p>
    </li>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <li className={cn(CARD, WIDTH.shelf)}>
      <Artwork artwork={artist.avatar} size="md" className="w-full rounded-full" />
      <Link
        href={`/artist/${artist.id}`}
        className="flex items-center gap-1 truncate font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent"
      >
        <span className="truncate">{artist.name}</span>
        {artist.verified && (
          <BadgeCheck className="size-4 shrink-0 text-accent" aria-label="Verified" />
        )}
      </Link>
      <p className="-mt-1.5 text-muted text-xs">Artist</p>
    </li>
  );
}

export function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <li className={cn(CARD, WIDTH.shelf)}>
      <Artwork artwork={collection.artwork} size="md" className="w-full rounded-md" />
      <Link
        href={`/collection/${collection.id}`}
        className="truncate font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-accent"
      >
        {collection.title}
      </Link>
      <p className="-mt-1.5 truncate text-muted text-xs">
        {collection.kind === 'album' ? 'Album' : 'Playlist'} · {collection.owner.name}
      </p>
    </li>
  );
}
```

`apps/web/components/media/source-notice.tsx`:

```tsx
import type { SourceId } from '@riff/core';
import { SOURCE_NAMES } from '@/components/player/now-playing';

type SourceStatus = 'ok' | 'error' | 'timeout' | 'disabled';

/** A quiet line naming sources that failed or timed out; results from the others still show. */
export function SourceNotice({ sources }: { sources: Partial<Record<SourceId, SourceStatus>> }) {
  const down = (Object.entries(sources) as [SourceId, SourceStatus][])
    .filter(([, status]) => status === 'error' || status === 'timeout')
    .map(([source]) => SOURCE_NAMES[source]);
  if (down.length === 0) return null;
  return (
    <p role="status" className="px-4 text-faint text-xs md:px-8">
      {down.join(' and ')} {down.length === 1 ? 'is' : 'are'} unavailable right now, so some results
      may be missing.
    </p>
  );
}
```

`apps/web/components/media/genre-grid.tsx`:

```tsx
import { GENRES } from '@riff/core';
import Link from 'next/link';

/** Six quiet tints so the grid has rhythm without competing with the ember accent. */
const TINTS = [
  'oklch(0.32 0.07 30)',
  'oklch(0.32 0.06 150)',
  'oklch(0.32 0.07 250)',
  'oklch(0.32 0.07 320)',
  'oklch(0.33 0.07 80)',
  'oklch(0.32 0.06 200)',
];

export const genreHref = (genre: string) => `/genre/${encodeURIComponent(genre)}`;

export function GenreGrid() {
  return (
    <ul className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:px-8 lg:grid-cols-4 xl:grid-cols-5">
      {GENRES.map((genre, index) => (
        <li key={genre}>
          <Link
            href={genreHref(genre)}
            style={{ backgroundColor: TINTS[index % TINTS.length] }}
            className="flex aspect-[5/3] items-end rounded-xl p-4 font-semibold text-lg leading-tight tracking-tight transition-[filter] hover:brightness-125"
          >
            {genre}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/lib/route-param.ts`:

```ts
'use client';

import { useParams } from 'next/navigation';

/** Decodes a percent-encoded route segment; a malformed one (e.g. a stray `%`) is used as-is. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A dynamic route segment, decoded (`/genre/Hip-Hop%2FRap` gives `Hip-Hop/Rap`). */
export function useRouteParam(name: string): string {
  const value = useParams<Record<string, string>>()[name];
  return decodeSegment(typeof value === 'string' ? value : '');
}
```

- [ ] **Step 4: Write the pages**

`/home` can take about 8 s when Audius is slow (Plan 2 handoff), so Home shows shelf skeletons until then. `/search` reads `useSearchParams`, which needs a Suspense boundary for static prerendering. On phones, the search page renders its own search box, because the top bar has no room for one.

`apps/web/app/(app)/page.tsx`:

```tsx
'use client';

import type { QueueContext, Track } from '@riff/core';
import { TrackCard } from '@/components/media/cards';
import { genreHref } from '@/components/media/genre-grid';
import { Shelf, ShelfSkeleton } from '@/components/media/shelf';
import { ErrorState } from '@/components/states/page-state';
import { useHome } from '@/lib/queries/library';

function TrackShelf({
  title,
  tracks,
  context,
  href,
}: {
  title: string;
  tracks: readonly Track[];
  context: QueueContext;
  href?: string;
}) {
  if (tracks.length === 0) return null;
  return (
    <Shelf title={title} href={href}>
      {tracks.map((track, index) => (
        <TrackCard key={`${track.id}-${index}`} tracks={tracks} index={index} context={context} />
      ))}
    </Shelf>
  );
}

export default function HomePage() {
  const home = useHome();
  return (
    <div className="flex flex-col gap-10 pt-4 pb-10">
      <h1 className="sr-only">Home</h1>
      {home.isPending ? (
        <>
          <ShelfSkeleton />
          <ShelfSkeleton />
          <ShelfSkeleton />
        </>
      ) : home.isError ? (
        <ErrorState error={home.error} onRetry={() => home.refetch()} />
      ) : (
        <>
          <TrackShelf
            title="Recently played"
            tracks={home.data.recentlyPlayed}
            context={{ type: 'history', name: 'Recently played' }}
          />
          <TrackShelf
            title="New from artists you follow"
            tracks={home.data.fromFollowed}
            context={{ type: 'artist', name: 'New from artists you follow' }}
          />
          {home.data.topGenres.map(({ genre, tracks }) => (
            <TrackShelf
              key={genre}
              title={`Trending in ${genre}`}
              tracks={tracks}
              href={genreHref(genre)}
              context={{ type: 'trending', id: genre, name: `Trending in ${genre}` }}
            />
          ))}
          <TrackShelf
            title="Trending this week"
            tracks={home.data.trending}
            context={{ type: 'trending', name: 'Trending this week' }}
          />
        </>
      )}
    </div>
  );
}
```

`apps/web/app/(app)/search/page.tsx`:

```tsx
'use client';

import { SearchX } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ArtistCard, CollectionCard, TrackCard } from '@/components/media/cards';
import { GenreGrid } from '@/components/media/genre-grid';
import { Shelf } from '@/components/media/shelf';
import { SourceNotice } from '@/components/media/source-notice';
import { SearchField } from '@/components/shell/search-field';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { searchText, useSearch } from '@/lib/queries/catalog';

function Results({ q }: { q: string }) {
  const search = useSearch(q);
  if (search.isPending) return <TrackListSkeleton />;
  if (search.isError) return <ErrorState error={search.error} onRetry={() => search.refetch()} />;
  const { tracks, artists, collections, stations, sources } = search.data;
  if (tracks.length + artists.length + collections.length + stations.length === 0) {
    return (
      <>
        <SourceNotice sources={sources} />
        <EmptyState icon={SearchX} title={`No results for “${q}”`}>
          Check the spelling, or try an artist, a genre or a station name.
        </EmptyState>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-10">
      <SourceNotice sources={sources} />
      {tracks.length > 0 && (
        <section className="flex flex-col gap-2 px-2 md:px-6">
          <h2 className="px-2 font-semibold text-xl tracking-tight md:px-2">Tracks</h2>
          <TrackList
            tracks={tracks}
            context={{ type: 'search', id: q, name: `Search: ${q}` }}
            showAlbum
          />
        </section>
      )}
      {artists.length > 0 && (
        <Shelf title="Artists">
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </Shelf>
      )}
      {collections.length > 0 && (
        <Shelf title="Albums and playlists">
          {collections.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}
        </Shelf>
      )}
      {stations.length > 0 && (
        <Shelf title="Radio stations">
          {stations.map((station, index) => (
            <TrackCard
              key={station.id}
              tracks={stations}
              index={index}
              context={{ type: 'radio', id: q, name: `Stations: ${q}` }}
            />
          ))}
        </Shelf>
      )}
    </div>
  );
}

function SearchContent() {
  const q = searchText(useSearchParams().get('q') ?? '');
  return (
    <div className="flex flex-col gap-6 pt-2 pb-10">
      <div className="px-4 md:hidden">
        <SearchField className="max-w-none" />
      </div>
      {q ? (
        <>
          <h1 className="sr-only">Search results for {q}</h1>
          <Results q={q} />
        </>
      ) : (
        <>
          <h1 className="px-4 font-semibold text-2xl tracking-tight md:px-8">Browse genres</h1>
          <GenreGrid />
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}
```

`apps/web/app/(app)/genre/[genre]/page.tsx`:

```tsx
'use client';

import { type TrendingWindow, TrendingWindowSchema } from '@riff/core';
import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { SourceNotice } from '@/components/media/source-notice';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTrending } from '@/lib/queries/catalog';
import { useRouteParam } from '@/lib/route-param';

const WINDOWS: { value: TrendingWindow; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'allTime', label: 'All time' },
];

export default function GenrePage() {
  const genre = useRouteParam('genre');
  const [period, setPeriod] = useState<TrendingWindow>('week');
  const trending = useTrending(genre, period);
  return (
    <div className="flex flex-col gap-6 pt-4 pb-10">
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <p className="font-medium text-muted text-sm">Trending</p>
        <h1 className="font-bold text-4xl tracking-tight md:text-6xl">{genre}</h1>
        <Tabs
          value={period}
          onValueChange={(value) => setPeriod(TrendingWindowSchema.parse(value))}
        >
          <TabsList aria-label="Period">
            {WINDOWS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <section className="px-2 md:px-6">
        {trending.isPending ? (
          <TrackListSkeleton />
        ) : trending.isError ? (
          <ErrorState error={trending.error} onRetry={() => trending.refetch()} />
        ) : trending.data.tracks.length === 0 ? (
          <EmptyState icon={TrendingUp} title={`Nothing trending in ${genre} right now`}>
            Try another period or genre.
          </EmptyState>
        ) : (
          <>
            <SourceNotice sources={trending.data.sources} />
            <TrackList
              tracks={trending.data.tracks}
              context={{ type: 'trending', id: genre, name: `Trending in ${genre}` }}
              showAlbum
            />
          </>
        )}
      </section>
    </div>
  );
}
```

`apps/web/app/(app)/artist/[id]/page.tsx`:

```tsx
'use client';

import type { QueueContext } from '@riff/core';
import { BadgeCheck, Music } from 'lucide-react';
import { Artwork, pickArtwork } from '@/components/media/artwork';
import { ArtistCard } from '@/components/media/cards';
import { PageHeader, PageHeaderSkeleton } from '@/components/media/page-header';
import { Shelf } from '@/components/media/shelf';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { TrackList, TrackListSkeleton } from '@/components/tracks/track-list';
import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import { useArtist, useArtistTracks, useRelatedArtists } from '@/lib/queries/catalog';
import { useFollowing, useToggleFollow } from '@/lib/queries/library';
import { useRouteParam } from '@/lib/route-param';

export default function ArtistPage() {
  const id = useRouteParam('id');
  const artist = useArtist(id);
  const tracks = useArtistTracks(id);
  const related = useRelatedArtists(id);
  const following = useFollowing();
  const toggleFollow = useToggleFollow();

  if (artist.isPending) return <PageHeaderSkeleton />;
  if (artist.isError) return <ErrorState error={artist.error} onRetry={() => artist.refetch()} />;

  const data = artist.data;
  const isFollowing = following.data?.some((a) => a.id === data.id) ?? false;
  const context: QueueContext = { type: 'artist', id: data.id, name: data.name };

  return (
    <div className="flex flex-col gap-8 pb-10">
      <PageHeader
        kind={
          <span className="inline-flex items-center gap-1.5">
            {data.verified && <BadgeCheck className="size-4 text-accent" aria-hidden />}
            {data.verified ? 'Verified artist' : 'Artist'}
          </span>
        }
        title={data.name}
        cover={<Artwork artwork={data.avatar} size="lg" className="w-full rounded-full" />}
        tintFrom={pickArtwork(data.avatar, 'sm')}
        meta={
          data.followerCount !== undefined
            ? `${formatCount(data.followerCount)} followers`
            : undefined
        }
      >
        <PlayContextButton tracks={tracks.data ?? []} context={context} />
        <Button
          variant="outline"
          aria-pressed={isFollowing}
          disabled={following.isPending}
          onClick={() => toggleFollow.mutate({ artist: data, follow: !isFollowing })}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </Button>
      </PageHeader>
      <section className="flex flex-col gap-2 px-2 md:px-6">
        <h2 className="px-2 font-semibold text-xl tracking-tight">Popular</h2>
        {tracks.isPending ? (
          <TrackListSkeleton rows={5} />
        ) : tracks.isError ? (
          <ErrorState error={tracks.error} onRetry={() => tracks.refetch()} />
        ) : tracks.data.length === 0 ? (
          <EmptyState icon={Music} title="No playable tracks yet" />
        ) : (
          <TrackList tracks={tracks.data} context={context} showAlbum />
        )}
      </section>
      {related.data && related.data.length > 0 && (
        <Shelf title="Fans also like">
          {related.data.map((other) => (
            <ArtistCard key={other.id} artist={other} />
          ))}
        </Shelf>
      )}
      {data.bio && (
        <section className="flex max-w-3xl flex-col gap-2 px-4 md:px-8">
          <h2 className="font-semibold text-xl tracking-tight">About</h2>
          <p className="whitespace-pre-line text-muted leading-relaxed">{data.bio}</p>
        </section>
      )}
    </div>
  );
}
```

`apps/web/app/(app)/collection/[id]/page.tsx`:

```tsx
'use client';

import { Music } from 'lucide-react';
import Link from 'next/link';
import { Artwork, pickArtwork } from '@/components/media/artwork';
import { PageHeader, PageHeaderSkeleton } from '@/components/media/page-header';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { TrackList } from '@/components/tracks/track-list';
import { formatDuration } from '@/lib/format';
import { useCollection } from '@/lib/queries/catalog';
import { useRouteParam } from '@/lib/route-param';

export default function CollectionPage() {
  const id = useRouteParam('id');
  const collection = useCollection(id);

  if (collection.isPending) return <PageHeaderSkeleton />;
  if (collection.isError) {
    return <ErrorState error={collection.error} onRetry={() => collection.refetch()} />;
  }

  const data = collection.data;
  const tracks = data.tracks ?? [];
  const total = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);
  const context = { type: 'collection' as const, id: data.id, name: data.title };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader
        kind={data.kind === 'album' ? 'Album' : 'Playlist'}
        title={data.title}
        cover={<Artwork artwork={data.artwork} size="lg" className="w-full rounded-md" />}
        tintFrom={pickArtwork(data.artwork, 'sm')}
        meta={
          <>
            <Link href={`/artist/${data.owner.id}`} className="font-medium text-fg hover:underline">
              {data.owner.name}
            </Link>
            {` · ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}, ${formatDuration(total)}`}
          </>
        }
      >
        <PlayContextButton tracks={tracks} context={context} />
      </PageHeader>
      {data.description && (
        <p className="max-w-3xl whitespace-pre-line px-4 text-muted text-sm md:px-8">
          {data.description}
        </p>
      )}
      <section className="px-2 md:px-6">
        {tracks.length === 0 ? (
          <EmptyState icon={Music} title="Nothing playable here">
            The tracks in this {data.kind} can’t be streamed.
          </EmptyState>
        ) : (
          <TrackList tracks={tracks} context={context} />
        )}
      </section>
    </div>
  );
}
```

`apps/web/app/(app)/radio/page.tsx`:

```tsx
'use client';

import type { QueueContext, Track } from '@riff/core';
import { Radio, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TrackCard } from '@/components/media/cards';
import { ShelfSkeleton } from '@/components/media/shelf';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { searchText, useRadioSearch, useRadioTop } from '@/lib/queries/catalog';

function StationGrid({ stations, context }: { stations: readonly Track[]; context: QueueContext }) {
  return (
    <ul className="grid grid-cols-2 gap-1 px-2 sm:grid-cols-3 md:px-6 lg:grid-cols-4 xl:grid-cols-6">
      {stations.map((station, index) => (
        <TrackCard
          key={station.id}
          tracks={stations}
          index={index}
          context={context}
          layout="grid"
        />
      ))}
    </ul>
  );
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function RadioPage() {
  const [input, setInput] = useState('');
  const q = searchText(useDebounced(input, 300));
  const top = useRadioTop();
  const results = useRadioSearch(q);
  const list = q ? results : top;

  return (
    <div className="flex flex-col gap-6 pt-4 pb-10">
      <div className="flex flex-col gap-4 px-4 md:px-8">
        <h1 className="font-bold text-4xl tracking-tight md:text-5xl">Radio</h1>
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search stations"
            placeholder="Search stations by name"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="h-11 w-full rounded-full border border-line bg-surface pr-4 pl-10 text-sm outline-none placeholder:text-faint hover:border-faint focus-visible:border-accent"
          />
        </div>
        <h2 className="font-semibold text-xl tracking-tight">
          {q ? `Stations matching “${q}”` : 'Popular stations'}
        </h2>
      </div>
      {list.isPending ? (
        <ShelfSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={Radio} title={q ? `No stations match “${q}”` : 'No stations right now'} />
      ) : (
        <StationGrid
          stations={list.data}
          context={
            q
              ? { type: 'radio', id: q, name: `Stations: ${q}` }
              : { type: 'radio', name: 'Popular stations' }
          }
        />
      )}
    </div>
  );
}
```

`apps/web/app/(app)/library/page.tsx`:

```tsx
'use client';

import { Plus } from 'lucide-react';
import { CreatePlaylistDialog } from '@/components/shell/create-playlist-dialog';
import { LibraryList } from '@/components/shell/library-list';
import { Button } from '@/components/ui/button';

/** The phone's Library tab (the sidebar shows the same list on larger screens). */
export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-4 px-2 pt-4 pb-10 md:px-6">
      <div className="flex items-center justify-between px-2">
        <h1 className="font-bold text-3xl tracking-tight">Your library</h1>
        <CreatePlaylistDialog>
          <Button variant="secondary" size="sm">
            <Plus /> New playlist
          </Button>
        </CreatePlaylistDialog>
      </div>
      <LibraryList />
    </div>
  );
}
```

- [ ] **Step 5: Run the tests, the build, and look at it**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck && pnpm build`
Expected:
- `Tests  239 passed (239)`: 220 plus source notice 2, route param 5, pages 12
- no type errors
- the build lists `/`, `/search`, `/radio`, `/library` and `/liked` as static, and the `[id]`/`[genre]` routes as dynamic

Then check with `pnpm dev` against the real upstreams:
- **Home** shows "Trending in …" shelves with artwork.
- **Search.** Searching "lofi" lists tracks, artists and stations. At 390 px width, `document.documentElement.scrollWidth` equals `clientWidth`.
- **Playback.** Clicking a card plays it: the play button turns into a spinner, then pause, and `document.getElementById('riff-audio').currentTime` advances.
- **Radio.** `/radio` shows a grid of stations. Playing one shows LIVE with Previous disabled.
- **Genre.** `/genre/Hip-Hop%2FRap` shows the heading "Hip-Hop/Rap".

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add Home, Search, Genre, Artist, Collection, Radio and Library pages"
```

### Task 13: The playlist page: edit, reorder, remove, delete

Playlists are user-sized, so the owner's list is not virtualised. That keeps every row registered with dnd-kit, and keyboard reordering reliable.

**Files:**
- Create: `apps/web/components/tracks/sortable-track-list.tsx`, `apps/web/components/playlists/edit-playlist-dialog.tsx`, `apps/web/components/playlists/delete-playlist-dialog.tsx`, `apps/web/app/(app)/playlist/[id]/page.tsx`
- Test: `apps/web/app/(app)/playlist/[id]/page.test.tsx`

**Interfaces:**
- Consumes:
  - `usePlaylist`, `useUpdatePlaylist`, `useDeletePlaylist`, `useMoveEntry`, `useRemoveEntry` and `afterIdForMove` from Task 7.
  - `TrackRow`, `COLUMNS` and `useNowPlaying` from Task 10.
  - `PageHeader`, `PlaylistCover` and the states from Task 11; `useRouteParam` from Task 12.
- Produces:
  - `<SortableTrackList entries context onMove(entryId, afterEntryId) onRemove(entryId)>`. Screen readers hear the track title and position during a drag ("<title> is at position 1 of 2."), not entry UUIDs.
  - `<EditPlaylistDialog playlist>` (name, description, public) and `<DeletePlaylistDialog playlist>` (confirms, then goes to `/library`).
  - The route `/playlist/[id]`:
    - the owner gets handles, edit and delete
    - anyone else sees a read-only `TrackList` of a public playlist

- [ ] **Step 1: Write the failing test**

`apps/web/app/(app)/playlist/[id]/page.test.tsx`:

```tsx
import type { PlaylistDetail } from '@riff/api';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { noContent, stubApi } from '@/test/api-stub';
import { track } from '@/test/fixtures';
import { player } from '@/test/player-mock';
import { queryWrapper } from '@/test/query-wrapper';
import PlaylistPage from './page';

vi.mock('@/lib/player/instance', () => import('@/test/player-mock'));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const PID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' }),
  useRouter: () => nav.router,
}));

function playlist(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  const entries = [
    { id: 'e1', track: track(1), addedAt: '2026-09-01T00:00:00Z' },
    { id: 'e2', track: track(2), addedAt: '2026-09-01T00:00:00Z' },
  ];
  return {
    id: PID,
    name: 'Night drive',
    description: 'For the long way home',
    coverUrl: null,
    isPublic: false,
    trackCount: entries.length,
    covers: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ownerId: 'u1',
    isOwner: true,
    entries,
    ...overrides,
  };
}

let requests: ReturnType<typeof stubApi>['requests'];
let current: PlaylistDetail;

beforeEach(() => {
  player.actions.reset();
  current = playlist();
  ({ requests } = stubApi({
    [`GET /api/playlists/${PID}`]: () => Response.json(current),
    [`PATCH /api/me/playlists/${PID}`]: ({ body }) => {
      current = { ...current, ...(body as object) };
      return Response.json(current);
    },
    [`DELETE /api/me/playlists/${PID}`]: noContent,
    [`DELETE /api/me/playlists/${PID}/tracks/e1`]: () => {
      current = { ...current, entries: current.entries.slice(1), trackCount: 1 };
      return noContent();
    },
    'GET /api/me/playlists': [],
    'GET /api/me/likes/ids': [],
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderPage() {
  const { wrapper } = queryWrapper();
  return render(<PlaylistPage />, { wrapper });
}

describe('Playlist page (owner)', () => {
  test('shows the playlist with reorder handles', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Night drive' })).toBeInTheDocument();
    expect(screen.getByText('For the long way home')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reorder / })).toHaveLength(2);
  });

  test('renames and makes it public', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Late drive');
    await userEvent.click(screen.getByRole('checkbox', { name: /Public/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Late drive' })).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      name: 'Late drive',
      description: 'For the long way home',
      isPublic: true,
    });
  });

  test('deletes after confirming, then leaves the page', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete playlist' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/library'));
    expect(
      requests.some((r) => r.method === 'DELETE' && r.path === `/api/me/playlists/${PID}`),
    ).toBe(true);
  });

  test('removes one entry from its menu', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'More options for Track 1' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Remove from this playlist' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Play Track 1' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Play Track 2' })).toBeInTheDocument();
  });

  test('an empty playlist points to search', async () => {
    current = playlist({ entries: [], trackCount: 0 });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Find tracks' })).toHaveAttribute(
      'href',
      '/search',
    );
  });
});

test('someone else’s public playlist is read-only', async () => {
  current = playlist({ isOwner: false, isPublic: true, ownerId: 'u2' });
  renderPage();
  expect(await screen.findByText('Public playlist')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Reorder / })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'More options for Track 1' }));
  await screen.findByRole('menuitem', { name: 'Add to queue' });
  expect(
    screen.queryByRole('menuitem', { name: 'Remove from this playlist' }),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @riff/web exec vitest run app/\(app\)/playlist`
Expected: FAIL, with `Failed to resolve import "./page"`.

- [ ] **Step 3: Write the sortable list, the dialogs and the page**

`apps/web/components/tracks/sortable-track-list.tsx`:

```tsx
'use client';

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlaylistEntry } from '@riff/api';
import type { QueueContext, Track } from '@riff/core';
import { GripVertical } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { player } from '@/lib/player/instance';
import { afterIdForMove } from '@/lib/queries/playlists';
import { COLUMNS, TrackRow, useNowPlaying } from './track-list';

interface SortableTrackListProps {
  entries: readonly PlaylistEntry[];
  context: QueueContext;
  /** Move `entryId` right after `afterEntryId` (null: to the top). */
  onMove: (entryId: string, afterEntryId: string | null) => void;
  onRemove: (entryId: string) => void;
}

/**
 * A playlist the user owns: rows reorder by dragging the handle, or with the keyboard
 * (focus the handle, Space, arrow keys, Space). Not virtualised: playlists are user-sized.
 */
export function SortableTrackList({ entries, context, onMove, onRemove }: SortableTrackListProps) {
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const tracks = useMemo(() => entries.map((entry) => entry.track), [entries]);
  const { currentId, playing } = useNowPlaying();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Spoken during keyboard drags; the defaults would read out entry UUIDs.
  const announcements = useMemo((): Announcements => {
    const title = (id: string | number) => entries.find((entry) => entry.id === id)?.track.title;
    const position = (id: string | number) =>
      `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`;
    return {
      onDragStart: ({ active }) => `Picked up ${title(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over ? `${title(active.id)} is at ${position(over.id)}.` : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? `${title(active.id)} dropped at ${position(over.id)}.`
          : `${title(active.id)} dropped.`,
      onDragCancel: ({ active }) => `Moving ${title(active.id)} was cancelled.`,
    };
  }, [entries, ids]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onMove(String(active.id), afterIdForMove(ids, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      accessibility={{ announcements }}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol aria-label={context.name} className="mt-2 flex flex-col">
          {entries.map((entry, index) => (
            <SortableEntry
              key={entry.id}
              id={entry.id}
              track={entry.track}
              index={index}
              isCurrent={entry.track.id === currentId}
              playing={playing}
              onPlay={() => {
                if (entry.track.id === currentId) player.actions.togglePlay();
                else player.actions.playContext(tracks, index, context);
              }}
              onRemove={() => onRemove(entry.id)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

interface SortableEntryProps {
  id: string;
  track: Track;
  index: number;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
  onRemove: () => void;
}

function SortableEntry({
  id,
  track,
  index,
  isCurrent,
  playing,
  onPlay,
  onRemove,
}: SortableEntryProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <li
      ref={setNodeRef}
      aria-current={isCurrent ? 'true' : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/entry flex items-center rounded-lg',
        isDragging && 'relative z-20 bg-raised shadow-black/50 shadow-xl',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${track.title}`}
        className="grid h-14 w-7 shrink-0 cursor-grab touch-none place-items-center rounded text-faint hover:text-fg active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <TrackRow
          track={track}
          index={index}
          columns={COLUMNS}
          showAlbum={false}
          isCurrent={isCurrent}
          playing={playing}
          onPlay={onPlay}
          onRemove={onRemove}
        />
      </div>
    </li>
  );
}
```

`apps/web/components/playlists/edit-playlist-dialog.tsx`:

```tsx
'use client';

import type { PlaylistDetail } from '@riff/api';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { useUpdatePlaylist } from '@/lib/queries/playlists';

export function EditPlaylistDialog({
  playlist,
  children,
}: {
  playlist: PlaylistDetail;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const update = useUpdatePlaylist(playlist.id);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    if (!name) return;
    update.mutate({
      name,
      description: String(form.get('description')).trim() || null,
      isPublic: form.get('isPublic') === 'on',
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title="Edit details">
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              name="name"
              required
              maxLength={100}
              defaultValue={playlist.name}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <textarea
              id="edit-description"
              name="description"
              maxLength={300}
              rows={3}
              defaultValue={playlist.description ?? ''}
              className="resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-faint hover:border-faint focus-visible:border-accent"
              placeholder="Optional"
            />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="isPublic"
              defaultChecked={playlist.isPublic}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              <span className="block font-medium">Public</span>
              <span className="block text-muted">
                Anyone signed in to this Riff with the link can see it.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/components/playlists/delete-playlist-dialog.tsx`:

```tsx
'use client';

import type { PlaylistDetail } from '@riff/api';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { useDeletePlaylist } from '@/lib/queries/playlists';

export function DeletePlaylistDialog({
  playlist,
  children,
}: {
  playlist: PlaylistDetail;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const remove = useDeletePlaylist();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        title={`Delete “${playlist.name}”?`}
        description="This removes the playlist from your library. It can’t be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className="bg-danger text-on-accent hover:bg-danger/90"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(playlist.id, {
                onSuccess: () => {
                  setOpen(false);
                  router.replace('/library');
                },
              })
            }
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/app/(app)/playlist/[id]/page.tsx`:

```tsx
'use client';

import type { QueueContext } from '@riff/core';
import { ListMusic, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { PlaylistCover } from '@/components/media/covers';
import { PageHeader, PageHeaderSkeleton } from '@/components/media/page-header';
import { DeletePlaylistDialog } from '@/components/playlists/delete-playlist-dialog';
import { EditPlaylistDialog } from '@/components/playlists/edit-playlist-dialog';
import { EmptyState, ErrorState } from '@/components/states/page-state';
import { PlayContextButton } from '@/components/tracks/play-context-button';
import { SortableTrackList } from '@/components/tracks/sortable-track-list';
import { TrackList } from '@/components/tracks/track-list';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/format';
import { useMoveEntry, usePlaylist, useRemoveEntry } from '@/lib/queries/playlists';
import { useRouteParam } from '@/lib/route-param';

export default function PlaylistPage() {
  const id = useRouteParam('id');
  const playlist = usePlaylist(id);
  const move = useMoveEntry(id);
  const remove = useRemoveEntry(id);
  const tracks = useMemo(
    () => playlist.data?.entries.map((entry) => entry.track) ?? [],
    [playlist.data],
  );

  if (playlist.isPending) return <PageHeaderSkeleton />;
  if (playlist.isError) {
    return <ErrorState error={playlist.error} onRetry={() => playlist.refetch()} />;
  }

  const data = playlist.data;
  const context: QueueContext = { type: 'playlist', id: data.id, name: data.name };
  const total = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

  return (
    <div className="flex flex-col gap-4 pb-10">
      <PageHeader
        kind={data.isPublic ? 'Public playlist' : 'Playlist'}
        title={data.name}
        cover={<PlaylistCover playlist={data} className="w-full" />}
        tintFrom={data.coverUrl ?? data.covers[0]}
        meta={
          <>
            {data.description && <p className="mb-1 text-muted">{data.description}</p>}
            {`${data.trackCount} ${data.trackCount === 1 ? 'track' : 'tracks'}`}
            {total > 0 && `, ${formatDuration(total)}`}
          </>
        }
      >
        <PlayContextButton tracks={tracks} context={context} />
        {data.isOwner && (
          <>
            <EditPlaylistDialog playlist={data}>
              <Button variant="ghost" size="icon" aria-label="Edit details">
                <Pencil />
              </Button>
            </EditPlaylistDialog>
            <DeletePlaylistDialog playlist={data}>
              <Button variant="ghost" size="icon" aria-label="Delete playlist">
                <Trash2 />
              </Button>
            </DeletePlaylistDialog>
          </>
        )}
      </PageHeader>
      <section className="px-2 md:px-6">
        {data.entries.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title="This playlist is empty"
            action={
              data.isOwner ? (
                <Button asChild variant="primary">
                  <Link href="/search">Find tracks</Link>
                </Button>
              ) : undefined
            }
          >
            {data.isOwner ? (
              <>
                Use <MoreHorizontal className="inline size-4" aria-label="the more options menu" />{' '}
                on any track, then Add to playlist.
              </>
            ) : null}
          </EmptyState>
        ) : data.isOwner ? (
          <SortableTrackList
            entries={data.entries}
            context={context}
            onMove={(entryId, afterEntryId) => move.mutate({ entryId, afterEntryId })}
            onRemove={(entryId) => remove.mutate(entryId)}
          />
        ) : (
          <TrackList tracks={tracks} context={context} rowKeys={data.entries.map((e) => e.id)} />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and try it**

Run: `pnpm --filter @riff/web exec vitest run && pnpm --filter @riff/web typecheck`
Expected: `Tests  245 passed (245)`, and no type errors.

With `pnpm dev`:
1. Create a playlist from the sidebar's +.
2. Add three tracks from search, using "…" → Add to playlist ▸.
3. On the playlist, focus the third track's grip and press Space, ↑, ↑, Space. The track moves to the top.
4. Reload. The order holds.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint
git add apps/web
git commit -m "feat(web): add the playlist page with editing, drag reorder and removal"
```

### Task 14: End-to-end tests, Vercel preview sign-in, and docs

**Files:**
- Modify: `packages/api/src/config.ts`, `packages/api/src/auth.ts`, `package.json`, `apps/web/package.json`, `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-27-riff-v1-design.md`
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/{global-setup,helpers}.ts`, `apps/web/e2e/{smoke,playlist,layout}.spec.ts`
- Test: `packages/api/src/config.test.ts` (two tests added), plus the e2e specs

**Interfaces:**
- Consumes: `migrateTestDatabase` from `@riff/db/testing`, and the whole app.
- Produces:
  - `ApiConfig.trustedOrigins: string[]`: `https://$VERCEL_URL` and `https://$VERCEL_BRANCH_URL` when Vercel sets them.
  - `AuthOptions.trustedOrigins?: string[]`, passed to Better Auth.
  - `pnpm test:e2e`, from the root or `apps/web`.

- [ ] **Step 1: Write the failing config tests**

A preview's URL never matches `BETTER_AUTH_URL`, so without this, sign-in on a preview fails Better Auth's origin check (Plan 2 handoff). Better Auth decides at import time to skip that check under `NODE_ENV=test`. The test therefore checks the resolved configuration; the check itself was confirmed against `next dev` (a foreign `Origin` gets 403 `INVALID_ORIGIN`).

Append to `packages/api/src/config.test.ts`:

```ts

describe('trusted origins (Vercel previews)', () => {
  test('trusts the deployment and branch URLs that Vercel sets', () => {
    const preview = {
      ...env,
      VERCEL_URL: 'riff-abc123.vercel.app',
      VERCEL_BRANCH_URL: 'riff-git-feat.vercel.app',
    };
    expect(apiConfigFromEnv(preview).trustedOrigins).toEqual([
      'https://riff-abc123.vercel.app',
      'https://riff-git-feat.vercel.app',
    ]);
    expect(apiConfigFromEnv(env).trustedOrigins).toEqual([]);
  });

  test('Better Auth trusts them next to the app URL', async () => {
    // Better Auth skips origin checks under NODE_ENV=test, so this checks its resolved
    // configuration; the check itself runs in dev and production.
    const { auth, close } = createApiFromEnv({
      ...env,
      VERCEL_BRANCH_URL: 'riff-git-feat.vercel.app',
    });
    const context = await auth.$context;
    expect(context.trustedOrigins).toEqual(
      expect.arrayContaining(['http://localhost:3000', 'https://riff-git-feat.vercel.app']),
    );
    expect(context.trustedOrigins).not.toContain('https://evil.example');
    await close();
  });
});
```

Run: `pnpm --filter @riff/api exec vitest run src/config.test.ts`
Expected:
- `× trusts the deployment and branch URLs that Vercel sets` (`expected undefined to deeply equal [ …(2) ]`)
- `× Better Auth trusts them next to the app URL`

- [ ] **Step 2: Trust the preview origins**

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
  /** Extra origins allowed to make cookie-bearing auth requests (Vercel preview URLs). */
  trustedOrigins: string[];
  catalog: CatalogConfig;
}

type Env = Readonly<Record<string, string | undefined>>;

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  ALLOW_SIGNUPS: z.enum(['true', 'false']).default('true'),
  // Set by Vercel on every deployment: its own hostname and its branch alias (no scheme).
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
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
    // A preview's URL never matches BETTER_AUTH_URL, so trust the preview's own hostnames.
    trustedOrigins: [parsed.data.VERCEL_URL, parsed.data.VERCEL_BRANCH_URL]
      .filter((host): host is string => Boolean(host))
      .map((host) => `https://${host}`),
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
    trustedOrigins: config.trustedOrigins,
  });
  return { app: createApp({ db, catalog, auth }), auth, close };
}
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
  /** Origins besides `baseURL` allowed to make cookie-bearing auth requests. */
  trustedOrigins?: string[];
}

export function createAuth({ db, secret, baseURL, allowSignups, trustedOrigins }: AuthOptions) {
  return betterAuth({
    appName: 'Riff',
    basePath: '/api/auth',
    baseURL,
    secret,
    trustedOrigins,
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
    // Better Auth renews a session at most once a day and sets a fresh cookie when it does;
    // forward that cookie, or the browser's copy expires while the DB session lives on.
    const { headers, response: session } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (!session) throw new ApiError('UNAUTHORIZED', 'Sign in to continue');
    for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
    c.set('user', session.user);
    await next();
  });
```

Run: `pnpm --filter @riff/api test && pnpm --filter @riff/api typecheck`
Expected: `Tests  113 passed | 1 skipped (114)`, and no type errors.

- [ ] **Step 3: Add Playwright**

In `apps/web/package.json`, add the script `"test:e2e": "playwright test"` after `typecheck`, and the dev dependency `"@riff/db": "workspace:*"` (it keeps alphabetical order after `@playwright/test`). In the root `package.json`, add the script `"test:e2e": "pnpm --filter @riff/web test:e2e"` after `db:migrate`. Run `pnpm install`.

The config loads the root `.env` itself. The web server's env is fixed when the config loads, before global setup runs, so global setup can't supply it. The config refuses any database whose name doesn't end in `_test`, because the tests sign up throwaway users. The server command calls `next` directly: through `pnpm start`, `next-server` survived Playwright's shutdown and the run hung.

`apps/web/playwright.config.ts`:

```ts
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The server signs up throwaway users, so it only ever runs against a *_test database.
const DATABASE_URL = process.env.DATABASE_URL_TEST ?? '';
if (!DATABASE_URL.split('?')[0]?.endsWith('_test')) {
  throw new Error(
    'Set DATABASE_URL_TEST to a database whose name ends in _test (see .env.example)',
  );
}

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end tests against a production build on :3200, using the riff_test database.
 * Tests tagged @live also need the real Audius API. Chrome is used by default (it plays
 * every stream codec); set PLAYWRIGHT_CHANNEL=chromium after `pnpm exec playwright install
 * chromium` where Chrome isn't installed.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    // `next` directly (not through pnpm), so stopping the server stops next-server too.
    command: `next build && next start -p ${PORT}`,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      ALLOW_SIGNUPS: 'true',
    },
  },
});
```

`apps/web/e2e/global-setup.ts`:

```ts
import { migrateTestDatabase } from '@riff/db/testing';

/** Brings riff_test up to date before the server under test starts using it. */
export default async function globalSetup() {
  await migrateTestDatabase();
}
```

`apps/web/e2e/helpers.ts`:

```ts
import { expect, type Page } from '@playwright/test';

/** Signs up a fresh user and lands on Home. */
export async function signUp(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('E2E Listener');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');
  return email;
}

/** Seconds of audio the player's element has played. */
export const audioTime = (page: Page) =>
  page.evaluate(
    () => (document.getElementById('riff-audio') as HTMLAudioElement | null)?.currentTime ?? 0,
  );

/** Searches from the top bar and waits for track results. */
export async function search(page: Page, q: string) {
  await page.getByRole('searchbox', { name: 'Search' }).fill(q);
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${q}`));
  const list = page.getByRole('list', { name: `Search: ${q}` });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  return list;
}
```

- [ ] **Step 4: Write the end-to-end tests**

The smoke test is spec §11's, verbatim. A dead Audius stream is skipped, so the test likes whichever track actually plays.

`apps/web/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { audioTime, search, signUp } from './helpers';

test('sign up, search, play, like, and find it in Liked Songs @live', async ({ page }) => {
  await signUp(page);
  const results = await search(page, 'lofi');
  await results
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: /^Play / })
    .click();

  // Audio actually plays. A dead stream is skipped, so whichever track plays is the one liked.
  await expect.poll(() => audioTime(page), { timeout: 45_000 }).toBeGreaterThan(2);

  const player = page.getByRole('region', { name: 'Player' });
  const like = player.getByRole('button', { name: /^Save .* to Liked Songs$/ });
  const title = (await like.getAttribute('aria-label'))?.replace(
    /^Save (.*) to Liked Songs$/,
    '$1',
  );
  expect(title).toBeTruthy();
  await like.click();
  await expect(
    player.getByRole('button', { name: `Remove ${title} from Liked Songs` }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Liked Songs' }).first().click();
  await expect(
    page.getByRole('list', { name: 'Liked Songs' }).getByText(title as string),
  ).toBeVisible();
});
```

The reorder test waits on dnd-kit's spoken announcements between keys. Without them, the keys arrive before the list is measured and nothing moves. Each add waits for its `POST` response, so the reload can't race the second add.

`apps/web/e2e/playlist.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { search, signUp } from './helpers';

test('a keyboard reorder of a playlist survives a reload @live', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New playlist' }).click();
  await page.getByLabel('Name').fill('Commute');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/playlist\//);
  const playlistUrl = page.url();

  const results = await search(page, 'ambient');
  const titles: string[] = [];
  for (const n of [0, 1]) {
    const row = results.getByRole('listitem').nth(n);
    titles.push((await row.getByRole('button', { name: /^Play / }).textContent()) ?? '');
    await row.getByRole('button', { name: /^More options/ }).click();
    // Keyboard into the submenu: pointer jumps can leave Radix's hover grace area.
    await page.getByRole('menuitem', { name: 'Add to playlist' }).focus();
    await page.keyboard.press('ArrowRight');
    const added = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/tracks'),
    );
    await page.getByRole('menuitem', { name: 'Commute' }).press('Enter');
    expect((await added).status()).toBe(201);
  }

  await page.goto(playlistUrl);
  const order = () =>
    page
      .getByRole('list', { name: 'Commute' })
      .getByRole('button', { name: /^(Play|Pause) / })
      .allTextContents();
  await expect.poll(order).toEqual(titles);

  // Each key waits for dnd-kit's spoken confirmation, so none arrives before the list is ready.
  const spoken = page.locator('[id^="DndLiveRegion"]');
  await page.getByRole('button', { name: `Reorder ${titles[1]}` }).focus();
  await page.keyboard.press('Space');
  // Picked up: dnd-kit then announces the starting position, over the item itself.
  await expect(spoken).toContainText(`${titles[1]} is at position 2 of 2`);
  await page.keyboard.press('ArrowUp');
  await expect(spoken).toContainText('is at position 1 of 2');
  await page.keyboard.press('Space');
  await expect(spoken).toContainText('dropped at position 1 of 2');
  await expect.poll(order).toEqual([titles[1], titles[0]]);

  await page.reload();
  await expect.poll(order).toEqual([titles[1], titles[0]]);
});
```

`apps/web/e2e/layout.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('signed-out visitors are sent to sign-in and brought back after', async ({ page }) => {
  await page.goto('/library');
  await expect(page).toHaveURL('/sign-in?next=%2Flibrary');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL('/sign-up?next=%2Flibrary');
});

test('pages fit a 360 px phone without sideways scrolling, and hydrate cleanly', async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/sign-in');
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBe(0);

  await signUp(page);
  for (const path of ['/library', '/liked', '/search']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
    expect(await overflow(), path).toBe(0);
  }
  expect(hydrationErrors).toEqual([]);
});
```

- [ ] **Step 5: Run the end-to-end suite**

Run: `pnpm test:e2e`
Expected, after the build:

```
  ✓  1 e2e/layout.spec.ts:4:1 › signed-out visitors are sent to sign-in and brought back after
  ✓  2 e2e/layout.spec.ts:11:1 › pages fit a 360 px phone without sideways scrolling, and hydrate cleanly
  ✓  3 e2e/playlist.spec.ts:4:1 › a keyboard reorder of a playlist survives a reload @live
  ✓  4 e2e/smoke.spec.ts:4:1 › sign up, search, play, like, and find it in Liked Songs @live

  4 passed
```

When it finishes, nothing is listening on :3200 (`ss -ltn | grep 3200` prints nothing). Without network access, `pnpm test:e2e --grep-invert @live` runs only the two layout tests.

- [ ] **Step 6: Update the docs**

Replace `README.md`:

`README.md`:

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
6. Start the app: `pnpm dev`, open http://localhost:3000 and create your account. Then set
   `ALLOW_SIGNUPS=false` in `.env` so nobody else can sign up.

End-to-end tests: `pnpm test:e2e` builds the app and drives Chrome against `riff_test`. Tests
tagged `@live` use the real Audius API; `pnpm test:e2e --grep-invert @live` skips them.

Design and plans live in `docs/superpowers/`.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play or pause |
| ← / → | Seek 5 s |
| Shift + ← / → | Previous / next track |
| M | Mute |
| L | Like the current track |
| / | Search |

## Deploying (Vercel + Neon)

1. Create a Neon project on Postgres 16 and note both connection strings: pooled and direct.
2. Apply the migrations from your machine with the direct URL:
   `DATABASE_URL='<direct url>' pnpm db:migrate`. Builds never migrate.
3. Create a Vercel project with root directory `apps/web` and Node.js 24. Set
   `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pinned pnpm, then add the env vars from
   `.env.example`: `DATABASE_URL` (the pooled URL), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   (the production URL), `ALLOW_SIGNUPS`, and the music source settings.
4. Preview deployments accept sign-in from their own URLs (`VERCEL_URL` and
   `VERCEL_BRANCH_URL`, which Vercel sets). They share production's env vars and database
   unless you override `DATABASE_URL` for the Preview environment.
````

In `CLAUDE.md` (the project guide half; leave the dual-graph policy below it untouched):
- Change the Plans line to: ``- Plans: `docs/superpowers/plans/`. Plans 1 (foundation), 2 (db + api) and 3 (web) are done.``
- Replace the "Coming in Plan 3" bullet under Layout with:

```markdown
- `apps/web`: the Next.js 16 app. `app/api/[[...route]]/route.ts` mounts the API, built on the first request. `lib/player/*` is the player: the audio engine, the store (`player.ts`), and the app's one `player` in `instance.ts`. `lib/queries/*` holds the TanStack Query hooks, `proxy.ts` sends signed-out visitors to `/sign-in`, and `e2e/` holds the Playwright tests.
```

- Under Commands, after the `pnpm test` bullet, add:

```markdown
- `pnpm dev`: the web app on http://localhost:3000. `next.config.ts` loads the root `.env`.
- `pnpm test:e2e`: builds the app and runs Playwright against `riff_test` on :3200 in Chrome (`PLAYWRIGHT_CHANNEL=chromium` where Chrome is missing). Tests tagged `@live` use the real Audius API; add `--grep-invert @live` to skip them.
```

- Under Conventions, after the playlist-positions bullet, add:

```markdown
- Web data: pages are client components over TanStack Query. Call the typed client through `unwrap()` / `expectOk()` from `apps/web/lib/api.ts`: they throw `ApiRequestError`, and a 401 sends the user to `/sign-in?next=`.
- Web component tests mock the player with `vi.mock('@/lib/player/instance', () => import('@/test/player-mock'))` and the network with `stubApi()` from `test/api-stub.ts`, inside `queryWrapper()`.
- Zustand selectors return stored references: derive arrays during render and wrap object selectors in `useShallow`. A selector that builds a new array re-renders forever.
- Biome's a11y rules apply to the web app: reach for semantic elements (`ol`/`li`, `search`, `section aria-label`) over ARIA roles on divs.
- UI copy uses typographic quotes and apostrophes (’ “ ”) and no em dashes.
```

- After the "Upstream quirks" list, add:

```markdown
- Test-tool quirks:
  - Better Auth skips its origin (CSRF) check under `NODE_ENV=test`, so origin behaviour shows only in dev and production.
  - Radix submenus close on pointer jumps; automation opens them with the keyboard (focus the trigger, then ArrowRight).
  - The player's audio element is `#riff-audio` in the document; the smoke test reads its `currentTime`.
```

In the spec (`docs/superpowers/specs/2026-09-27-riff-v1-design.md`):
- §8 Load: after step 4, add:

```markdown
  5. A source that sends no audio for 15 s (a stalled mirror reports no error) counts as a failed source.
  6. After 3 tracks fail in a row, playback stops with an error instead of skipping through the whole queue.
```

- §8 History: change "accumulated audible playback time (not position)" to "accumulated audible playback time (not position; playing and not muted)".
- §9 Routes: after the `/radio` line, add:

```
/library                                Library: Liked Songs, playlists, followed artists (the phone's third tab)
```

- §11 `web`: replace the bullet with:

```markdown
- **`web`:**
  - Vitest + Testing Library for the player (engine, store, persistence, Media Session, shortcuts), the query hooks and the components, with `fetch` stubbed.
  - Playwright against a production build and `riff_test`: the smoke test tagged `@live` (uses real Audius): sign up → search "lofi" → play the first result → `currentTime` advances → like → it appears in Liked Songs. Also a `@live` playlist keyboard-reorder test, and offline checks for the sign-in redirect and 360 px layouts.
```

- §12 env table: after `RADIO_BROWSER_SERVERS`, add the row: ``| `VERCEL_URL`, `VERCEL_BRANCH_URL` | set by Vercel; a preview trusts its own URLs for sign-in |``

- [ ] **Step 7: Verify everything, then commit**

Run:
```bash
pnpm format && pnpm lint
pnpm test --force
pnpm typecheck --force
pnpm build
```
Expected:
- core 70, catalog 83 (+5 skipped), db 8, api 113 (+1 skipped), web 245
- `Tasks: 5 successful, 5 total` for the tests and for the typecheck
- a clean build

```bash
git add package.json pnpm-lock.yaml apps/web packages/api README.md CLAUDE.md docs/superpowers/specs
git commit -m "feat(web): add end-to-end tests, trust Vercel preview origins for sign-in, and document the web app"
```

---

## After the last task

**Observed while building (not fixed here):**
- **First-play latency.** `/api/stream/:id` took about 1 s against Audius: a track lookup, then the stream URL. That already spends the spec's ≤ 1 s start target before the audio request begins. Prefetch hides it for every following track. A later fix could have the catalog cache the tracks that search and trending return, so `resolveStream` skips the lookup.
- **Radio Browser's "top" list** follows whichever region clicks most (it was mostly Lagos stations on 2026-09-28). A country or tag default would help. Many station logos are tiny or broken; tiles fall back to a placeholder.
- **Automated screenshots produce false hydration warnings.** The Playwright MCP injects `caret-color` into inputs during screenshots, which shows up as a hydration warning. The layout e2e test confirms real page loads hydrate cleanly.
- **Vercel deployment.** The Vercel steps in the README follow the documented platform behaviour but haven't been exercised by a real deploy.
- **Sign-in rate limiting.** There is none beyond Better Auth's defaults. Its limiter is in-memory, so on Vercel it applies per instance. The spec lists rate limiting as a non-goal; `ALLOW_SIGNUPS=false` is the main protection for a personal deployment.

**Still deferred from the Plan 1 and Plan 2 reviews.** Plan 1 #5 and #6 are fixed in Task 1. This list keeps the rest on record.
- Plan 2:
  1. The same id spelled two ways in one add returns 500.
  2. Blank optional params return 400 instead of meaning "unset". The web client never sends them.
  3. `/api/auth/*` responses carry no `Cache-Control: no-store`.
  4. A Better Auth `APIError` from `getSession` maps to 500.
  5. One slow Home section delays all of `/home`. The web client shows skeletons meanwhile.
  6. Entity-id inputs have no maximum length.
  7. Upstream 502/504 on single-entity routes are not reported to `onError`.
  8. A 5xx `HTTPException` passes its message through.
  9. Adding 100 ids fires 100 parallel `getTrack` calls. The UI adds one track at a time.
- Plan 1:
  1. LRCLIB `pickBest` takes the first synced candidate within ±3 s, not the closest.
  2. `parseLrc` treats a mid-line `[mm:ss]` as a timestamp, and word-tag stripping leaves double spaces.
  3. `normalizeForMatch` keeps "featuring", and emoji-only titles normalise to "".
  4. The search cache key isn't whitespace-collapsed or NFC-normalised. The web client collapses whitespace before searching.
  7. Audius collection `trackCount` is the raw count while `tracks` is filtered. The collection page counts the tracks it shows.
  8. Audius `getArtistTracks` and `getRelatedArtists` return 502 for unknown ids.
  9. A throwing `onSourceError` rejects the whole search.
  10. The live suite's `Array.isArray(collection.tracks)` check can't detect mapping drift.
  11. Queue tests lack shuffle/repeat × upNext combinations. Task 1 adds the wrap case.

**Next:** the spec's v1.1 roadmap (offline downloads, gapless playback and crossfade, EQ, Spotify playlist import) and v2 (the Expo app). The Expo app reuses `@riff/core` and `@riff/api/client`. `lib/player/player.ts` is written against `EngineLike`, so a `react-native-track-player` engine can stand in for `AudioEngine`.
