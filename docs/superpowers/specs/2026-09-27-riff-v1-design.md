# Riff v1 — Design Spec

- **Date:** 2026-09-27
- **Status:** Approved in conversation; pending written-spec review
- **Working name:** Riff (rename is a find/replace of the `@riff/` scope and UI strings)

## 1. Purpose

A free, Spotify-like music app that the owner uses as a **personal daily driver**, on the web now and on a native mobile app later. It streams full-length music only from **legal, free sources**. Optimize for playback UX and reliability, not multi-tenant scale.

### Success criteria (v1)

1. Sign up / sign in; all app routes require a session.
2. Search returns tracks, artists, collections and radio stations from all enabled sources in one response. A cold search takes ≤ 2 s p50; a cached search takes ≤ 200 ms.
3. Clicking play starts audio in ≤ 1 s on a normal connection.
4. The queue supports play-next, add-to-queue, reorder, remove, shuffle and repeat (off/all/one). The queue and playback position survive a page reload.
5. Liked songs, user playlists (create/rename/delete/reorder) and followed artists persist in Postgres.
6. Home shows recently played, trending by the user's top genres, and new tracks from followed artists.
7. Synced lyrics show when LRCLIB has them, highlighted to follow playback; clicking a line seeks to it.
8. OS media controls work (lock screen, keyboard media keys, headset buttons).
9. Live radio stations play.
10. Usable at phone width (≥ 360 px).
11. Deploys to Vercel + Neon by changing env vars only.

### Non-goals (v1)

Offline downloads, gapless/crossfade, EQ, the native mobile app, social features, uploading music, mainstream label catalog, rate limiting, admin tooling. These are in the roadmap (§12) or out of scope.

## 2. Music sources

Verified live on 2026-09-27.

| Source | Role | Auth | Notes |
|---|---|---|---|
| **Audius** `api.audius.co/v1` | Primary catalog: tracks, artists, playlists/albums, trending by genre, related artists | `app_name` query param only | `/tracks/{id}/stream?no_redirect=true` returns a signed URL. The track JSON includes `stream.mirrors` (alternate hosts for the same path). Media and artwork hosts send `Access-Control-Allow-Origin: *` and support byte ranges. Filter out tracks that are `!is_streamable`, `is_stream_gated`, or `is_delete`. Unknown ids return **400** `invalid trackId` (not 404); treat 400/404 on single-entity reads as not-found. `/users/{id}/tracks?sort=plays` returns the artist pick first, then tracks by plays. |
| **Jamendo** `api.jamendo.com/v3.0` | Secondary catalog (Creative Commons) | Free `client_id` | The adapter is enabled only when `JAMENDO_CLIENT_ID` is set. Tests use fixtures. |
| **Radio Browser** `*.api.radio-browser.info/json` | Live radio | None; send a descriptive `User-Agent` | Keep only stations with an **https** `url_resolved` and `hls == 0`: browsers block http media on https pages, and HLS needs extra tooling. Call `/json/url/{uuid}` on play, as their guidelines ask. |
| **LRCLIB** `lrclib.net/api` | Lyrics (synced LRC + plain) | None; send `User-Agent` | Try `/get` (artist + title + duration) first, then fall back to `/search` and pick the candidate with the closest duration (±3 s). |

**Known limitation (accepted):** no legal free API streams full-length mainstream label music. YouTube-scraping approaches break its ToS and are excluded. New sources plug in through the adapter interface (§5).

## 3. Architecture

### Monorepo (pnpm workspaces + Turborepo)

```
apps/
  web/            Next.js (App Router). UI + mounts @riff/api at /api/*
packages/
  core/           Domain types, zod schemas, id helpers, queue state machine, LRC parser. No I/O.
  catalog/        Source adapters, aggregator, TTL cache, lyrics client. Depends on core.
  db/             Drizzle schema, migrations, client factory. Depends on core (types only).
  api/            Hono app: routes, auth (Better Auth), validation, error mapping.
                  Depends on core, catalog, db. Runtime-agnostic (Web Fetch API only).
```

**Why the API is a package rather than an app:** v1 mounts it inside Next.js (`app/api/[[...route]]/route.ts` using `hono/vercel`'s `handle`). That gives one process in development, one free Vercel deployment, same-origin cookies and no CORS. Later it can be served standalone (Node, Bun or Cloudflare Workers) with a ~10-line entry file when the mobile app or scale needs it. Nothing in `packages/api` may import Next.js.

**Typed client:** the web app calls the API through `hc<AppType>('/api')` from `hono/client`. The v2 mobile app reuses the same client and types.

### Tech choices

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict` everywhere. Use the version the pinned Next.js supports. |
| Web | Next.js 16 App Router, React 19, Tailwind CSS v4, Radix primitives via shadcn/ui, lucide-react icons |
| Server state | TanStack Query (optimistic updates for likes, playlist edits and follows) |
| Client state | Zustand (player, UI panels) |
| API | Hono 4 + zod validation |
| Auth | Better Auth (email + password) with Drizzle adapter |
| DB | PostgreSQL 16 through Drizzle ORM + drizzle-kit migrations. Driver: `postgres` (postgres.js) in all environments. |
| Ordering | `fractional-indexing` for playlist positions |
| Lists | `@tanstack/react-virtual` for long track lists; `@dnd-kit` for drag reorder |
| Lint/format | Biome |
| Tests | Vitest (packages + API), Playwright (web smoke) |

**DB driver note:** production uses Neon's **pooled** connection string with postgres.js (`prepare: false`). One driver everywhere keeps transactions simple. `@neondatabase/serverless` is only needed if the API ever moves to an edge runtime.

## 4. Domain model (`packages/core`)

```ts
type SourceId = 'audius' | 'jamendo' | 'radio';
type EntityId = `${SourceId}:${string}`;        // e.g. "audius:NQwXON0"

interface Artwork { sm?: string; md?: string; lg?: string }   // ~150 / ~480 / ~1000 px
interface ArtistRef { id: EntityId; name: string }

interface Track {
  id: EntityId; source: SourceId;
  title: string;
  artists: ArtistRef[];                  // primary first
  album?: { id: EntityId; title: string };
  durationSec: number | null;            // null ⇔ live stream
  isLive: boolean;                       // radio stations are live Tracks
  artwork: Artwork;
  genre?: string; mood?: string; bpm?: number;
  releaseDate?: string;                  // ISO 8601
  playCount?: number;
  permalink?: string;                    // attribution link to the source page
}

interface Artist {
  id: EntityId; source: SourceId; name: string; handle?: string;
  avatar: Artwork; banner?: string; bio?: string;
  followerCount?: number; trackCount?: number; verified: boolean;
}

interface Collection {                   // source-side playlist or album
  id: EntityId; source: SourceId; kind: 'playlist' | 'album';
  title: string; description?: string; artwork: Artwork;
  owner: ArtistRef; trackCount?: number; tracks?: Track[];
}

interface Lyrics {
  synced: { timeMs: number; text: string }[] | null;
  plain: string | null;
  instrumental: boolean;
}
```

User playlists live in the DB with **UUID** ids. They never collide with source ids, which always contain a `:`. `core` also ships the zod schemas for these types, `parseEntityId`/`makeEntityId`, the LRC parser, and the `GENRES` constant (Audius genre names, used for the browse grid).

## 5. Catalog (`packages/catalog`)

### Adapter interface

```ts
interface SourceAdapter {
  readonly id: SourceId;
  searchTracks(q: string, o: { limit: number; signal: AbortSignal }): Promise<Track[]>;
  searchArtists?(q: string, o): Promise<Artist[]>;
  searchCollections?(q: string, o): Promise<Collection[]>;
  trending?(o: { genre?: string; window?: 'week' | 'month' | 'allTime'; limit: number; signal }): Promise<Track[]>;
  getTrack(nativeId: string, o): Promise<Track | null>;
  getArtist?(nativeId: string, o): Promise<Artist | null>;
  getArtistTracks?(nativeId: string, o: { limit: number; sort?: 'popular' | 'newest'; signal }): Promise<Track[]>;
  getRelatedArtists?(nativeId: string, o): Promise<Artist[]>;
  getCollection?(nativeId: string, o): Promise<Collection | null>;   // includes tracks
  resolveStream(nativeId: string, o): Promise<StreamInfo>;
}
interface StreamInfo { url: string; mirrors: string[]; live: boolean }
```

Adapters receive `{ http, config }` at construction time. `http` is an `HttpClient` over an injected `fetch`, so tests can use fixtures. Each adapter maps raw JSON to domain types in one pure `map*` function per entity.

- **Audius:** `resolveStream` uses `stream.url` from the track JSON and falls back to `/tracks/{id}/stream?no_redirect=true`. Mirrors are built by swapping the host of the signed URL for each host in `stream.mirrors`. Base URL and app name come from env.
- **Radio:** `searchTracks` searches stations by name and returns live `Track`s. The adapter does **not** implement `trending`. Instead it has an extra `top({ tag?, limit })` method backing `/radio/top` and `/radio/search?tag=`, filtered as in §2. `resolveStream` calls `/json/url/{uuid}`. It tries a list of mirror servers (`de1`, `de2`) in order.

### Aggregator

- **Routing:** single-entity calls go to the adapter named by the id prefix. Unknown prefix → `NotFound`.
- **Fan-out:** `search` and `trending` call every enabled adapter with `Promise.allSettled` and a per-source `AbortSignal.timeout(3000)`.
- **Merge:** tracks are interleaved round-robin across sources, keeping each source's own relevance order. They are deduped **across sources only** on a normalized `artist|title` key (lowercased, accents and punctuation stripped, `feat.`/`ft.` credits removed; other bracketed words like "Remix" kept; first occurrence wins). Same-source near-duplicates are kept. Stations are kept in a separate `stations` list, never mixed into `tracks`.
- **Response:** `{ tracks, artists, collections, stations, sources: Record<SourceId, 'ok'|'error'|'timeout'|'disabled'> }`. One source failing never fails the request.

### Cache

A `Cache` interface (`get`, `set(key, value, ttlMs)`, `getOrSet(key, ttlMs, loader)`) with an in-memory LRU implementation (1000 entries). `getOrSet` is **single-flight**: concurrent misses for the same key share one loader promise.

| Data | TTL |
|---|---|
| Search | 5 min |
| Trending | 10 min |
| Track / artist / collection / related | 1 h |
| Lyrics (including "not found") | 24 h (6 h for not found) |
| Stream resolution | not cached (signed URLs) |

### Lyrics

`getLyrics({ title, artist, album?, durationSec? })` → `Lyrics | null`. It is not a `SourceAdapter`, because it doesn't supply tracks. Skipped for live tracks.

## 6. API (`packages/api`)

All routes are under `/api`. Everything except `/api/health` and `/api/auth/*` requires a session (`requireUser` middleware → `401`).

### Catalog

| Method + path | Returns |
|---|---|
| `GET /health` | `{ ok: true }` |
| `GET /search?q=&limit=20` | Aggregated result (§5) |
| `GET /trending?genre=&window=week&limit=30` | `{ tracks, sources }` |
| `GET /genres` | `GENRES` |
| `GET /tracks/:id` | `Track` |
| `GET /tracks/:id/lyrics` | `Lyrics`, or `404` |
| `GET /stream/:id` | `302` to the resolved URL; with `?format=json` returns `StreamInfo` (used by the player for mirror fallback) |
| `GET /artists/:id` · `/artists/:id/tracks` · `/artists/:id/related` | `Artist` · `Track[]` · `Artist[]` |
| `GET /collections/:id` | `Collection` with tracks |
| `GET /radio/top?tag=` · `GET /radio/search?q=&tag=` | `Track[]` (live). `q` searches station names; `tag` alone lists that tag's top stations. |

### Library (current user)

| Method + path | Behavior |
|---|---|
| `GET /me` | User profile |
| `GET /home` | `{ recentlyPlayed: Track[], topGenres: { genre, tracks }[], fromFollowed: Track[], trending: Track[] }` |
| `GET /me/likes?cursor=` | `{ items: { track, likedAt }[], nextCursor }`: liked tracks, newest first, 50 per page |
| `GET /me/likes/ids` | `EntityId[]`: all liked ids (for heart icons) |
| `PUT /me/likes/:trackId` · `DELETE …` | Like / unlike (idempotent) |
| `GET /me/playlists` · `POST /me/playlists` | List / create `{ name, description? }` |
| `GET /playlists/:id` | Playlist + entries. Visible to the owner, or to anyone if `is_public`. |
| `PATCH /me/playlists/:id` · `DELETE …` | Rename, change description or visibility / delete |
| `POST /me/playlists/:id/tracks` | `{ trackIds: EntityId[] }` appended in order |
| `PATCH /me/playlists/:id/tracks/:entryId` | `{ afterEntryId: string \| null }`: reorder (null = first) |
| `DELETE /me/playlists/:id/tracks/:entryId` | Remove one entry |
| `GET /me/following` · `PUT/DELETE /me/following/:artistId` | Followed artists |
| `POST /me/history` | `{ trackId, msPlayed, context? }` |
| `GET /me/history/recent?limit=20` | Distinct recent tracks, newest first |

**Snapshots:** when a track is liked, added to a playlist or recorded in history, the server fetches it through the catalog (cached) and upserts it into `tracks`. The client never supplies metadata. Following an artist stores an `Artist` snapshot the same way. Library reads come only from the DB, so they work while a source is down.

**Home composition:**
- Top genres: the 3 most frequent genres in the last 200 history rows plus likes. With fewer than 3, top up from `['Electronic', 'Hip-Hop/Rap', 'Lo-Fi']`.
- `fromFollowed`: the newest tracks of up to 10 followed artists.
- Sections are built in parallel; a failed section returns empty.

### Auth

Better Auth mounted at `/api/auth/*`, email + password, httpOnly session cookie. `ALLOW_SIGNUPS=false` disables sign-up once the owner's account exists. The v2 mobile app adds Better Auth's Expo plugin (bearer sessions) without changing routes.

### Errors and headers

- **Error body:** always `{ error: { code, message } }` (Better Auth's own `/api/auth/*` responses keep its format). Codes: `BAD_REQUEST` 400 (zod), `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `UPSTREAM_ERROR` 502, `UPSTREAM_TIMEOUT` 504, `INTERNAL` 500.
- **Mapping:** typed errors thrown by catalog/db are mapped in one `onError` handler.
- **Cache headers:**
  - Catalog GETs: `Cache-Control: private, max-age=<ttl/2>`. `private` because every route requires a session.
  - `/me/*`, `/home` and `/stream/*`: `no-store`.

## 7. Database (`packages/db`)

Better Auth tables (`user`, `session`, `account`, `verification`) are generated by the Better Auth CLI into the Drizzle schema. App tables:

```
tracks            id text PK (EntityId) · source text · title text · artist_name text
                  · data jsonb (Track) · updated_at timestamptz
                  GIN trigram index on (title || ' ' || artist_name)      -- library search
liked_tracks      user_id → user ON DELETE CASCADE · track_id → tracks · created_at
                  PK (user_id, track_id) · index (user_id, created_at DESC)
playlists         id uuid PK · owner_id → user CASCADE · name · description · cover_url
                  · is_public bool default false · created_at · updated_at
playlist_tracks   id uuid PK (entry id; duplicates allowed) · playlist_id → playlists CASCADE
                  · track_id → tracks · position text (fractional index) · added_at
                  UNIQUE (playlist_id, position)
play_history      id bigint identity PK · user_id → user CASCADE · track_id → tracks
                  · played_at timestamptz · ms_played int · context text
                  index (user_id, played_at DESC)
followed_artists  user_id → user CASCADE · artist_id text · data jsonb (Artist) · created_at
                  PK (user_id, artist_id)
```

- **Playlist order:** reordering computes a key between neighbors with `generateKeyBetween`, so one row is updated.
- **Playlist cover:** if `cover_url` is null, the UI renders a 2×2 mosaic of the first four artworks.
- **Extensions:** `pg_trgm` is created by migration. It is a trusted extension, so the database owner can create it without superuser.

## 8. Player

### Queue state machine (`packages/core/queue.ts`)

A pure reducer with an injectable RNG, designed to be unit-tested exhaustively.

```ts
interface QueueItem { uid: string; track: Track }   // uid distinguishes duplicate tracks
interface QueueState {
  context: { type: 'playlist'|'collection'|'artist'|'liked'|'search'|'trending'|'radio'|'history'; id?: string; name: string } | null;
  original: QueueItem[];      // context order
  order: QueueItem[];         // play order (== original unless shuffled)
  index: number;              // position in `order` of the last context item played
  upNext: QueueItem[];        // user-added items, played before the context continues
  current: QueueItem | null;
  currentFromUpNext: boolean;
  shuffle: boolean; repeat: 'off' | 'all' | 'one';
}
```

Actions and rules:
- `playContext(tracks, startIndex, context)` replaces the context and keeps `upNext`. If shuffle is on, the start track goes first and the rest are shuffled.
- `next()`:
  - If `upNext` is non-empty, take its head.
  - Otherwise play `order[index+1]`.
  - At the end of the context: with `repeat all`, wrap to 0 (reshuffling if shuffle is on); otherwise stop, keeping `current` and setting status to ended.
- `trackEnded()`: with `repeat one`, replay; otherwise `next()`.
- `prev(positionSec)`: if more than 3 s in, restart the track (reported as an effect); otherwise play `order[index-1]`, or restart if at 0.
- `toggleShuffle()`:
  - On: Fisher–Yates shuffle of the remaining items after `current`.
  - Off: restore `original`, with `index` set to the current item's original position.
- `cycleRepeat()` cycles off → all → one.
- Queue editing: `addToQueue(tracks)` (tail of `upNext`), `playNext(tracks)` (head of `upNext`), `removeFromQueue(uid)`, `moveInQueue(uid, toIndex)` (within `upNext`), `jumpTo(uid)`, `clearUpNext()`.
- `queue.upcoming(state)` returns `upNext` followed by the rest of `order` (what the queue panel shows).

### Web audio engine (`apps/web/lib/player/`)

- **`AudioEngine`:** a plain class that owns one `HTMLAudioElement`. It is outside React and bridged to a Zustand store (`usePlayer`) holding queue state, status (`idle|loading|playing|paused|ended|error`), position, duration, volume and muted.
- **Load:**
  1. `GET /api/stream/:id?format=json`, then set `src`.
  2. On a media `error`: try the next mirror.
  3. If all mirrors fail: re-resolve once. This also covers expired signatures during a seek; playback resumes at the saved position.
  4. If that also fails: toast "Couldn't play …" and `next()`.
  5. A source that sends no audio for 15 s (a stalled mirror reports no error) counts as a failed source.
  6. After 3 tracks fail in a row, playback stops with an error instead of skipping through the whole queue.
- **Prefetch:** when a track starts, resolve the next item's `StreamInfo` (not its audio) to cut start latency.
- **Media Session:**
  - Metadata: title, artists, all artwork sizes.
  - Handlers: `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`/`seekforward` (10 s).
  - `setPositionState` is updated each second, and not for live tracks.
- **Keyboard** (ignored while typing in inputs):
  - `Space` play/pause
  - `←`/`→` seek 5 s
  - `Shift+←`/`Shift+→` previous/next
  - `M` mute
  - `L` like current
  - `/` focus search
- **Volume:** the slider value `v` maps to `audio.volume = v²` (perceptual).
- **Persistence:** `localStorage` key `riff:player:v1` stores queue state, the current position and volume. It is written every 5 s and on `pagehide`, then restored on load **paused**.
- **History:** accumulated audible playback time (not position; playing and not muted) is tracked for each play. `POST /me/history` is sent once when it reaches 30 s, or on `ended` if the track is shorter.
- **Live tracks:** no seek bar or duration (a "LIVE" badge instead), and prev/seek are disabled.

## 9. Web app (`apps/web`)

### Routes

```
/sign-in, /sign-up                      (auth) layout
/                                       Home
/search?q=                              Search (genre grid when q is empty)
/genre/[genre]                          Trending in genre (week / month / all-time tabs)
/artist/[id]                            Artist: header, top tracks, related, follow button
/collection/[id]                        Source playlist/album
/playlist/[id]                          User playlist (edit, drag reorder, remove)
/liked                                  Liked Songs
/radio                                  Radio: top stations + search
/library                                Library: Liked Songs, playlists, followed artists (the phone's third tab)
```

- **Route protection:** Next.js `proxy.ts` (Next 16's replacement for middleware) redirects requests without a session cookie to `/sign-in`. The API still enforces auth itself.
- **Data fetching:** pages are client components using TanStack Query + the typed Hono client. The server renders only the shell. That keeps the data layer identical to the future mobile app, and the player stays mounted across navigations because it lives in the root `(app)` layout.

### Layout

- **Desktop (≥ 1024 px):** a grid with a collapsible left sidebar (library: Liked Songs, playlists, followed artists; create playlist), the main scroll area, an optional right panel (tabs: Queue · Lyrics · Now Playing) and a bottom player bar.
- **Tablet:** the sidebar collapses to icons.
- **Phone:** a bottom tab bar (Home · Search · Library) with a mini-player above it; tapping the mini-player opens a full-screen Now Playing sheet (artwork, controls, lyrics).

### Key components

- **`TrackList`:** virtualized. Rows show index or equalizer animation, artwork, title, artists, album, duration and a like button. Right-click and the "…" button open a menu with Play next, Add to queue, Add to playlist ▸, Like, Go to artist, Open on source.
- **`PlayerBar`**, **`SeekBar`** (drag, keyboard accessible), **`VolumeControl`**.
- **`QueuePanel`:** drag to reorder `upNext`.
- **`LyricsPanel`:** the active line is found by binary search on `timeMs`; auto-scroll pauses for 3 s after a manual scroll; clicking a line seeks to it.
- **Now Playing background:** a gradient from the artwork's dominant color, extracted client-side on a small canvas (artwork hosts allow CORS).

### Visual direction

Dark UI with its own identity. Not a pixel copy of Spotify, and not Spotify green. Dense but legible type and generous artwork. All interactive elements are keyboard reachable with visible focus rings, and animations respect `prefers-reduced-motion`.

## 10. Error handling

| Failure | Behavior |
|---|---|
| One source down or slow during search/trending | Partial results. The per-source status is shown as a subtle notice ("Jamendo unavailable"). |
| Single-entity upstream failure | 502/504 → a page-level error state with a Retry button |
| Stream failure | Mirrors → re-resolve → toast + skip (§8) |
| Lyrics missing | Lyrics tab shows "No lyrics for this track" |
| Snapshot fetch fails on like/add | 502. The optimistic UI rolls back with a toast. |
| Session expired | 401 → redirect to `/sign-in?next=<path>` |
| Invalid input | 400 with the zod message |

## 11. Testing

- **`core`:** exhaustive reducer tests (every action × shuffle/repeat combinations, duplicates, empty queues), LRC parser, id helpers, dedupe-key normalization.
- **`catalog`:**
  - Adapters are tested through an injected `fetch` against typed fixture factories trimmed from real API responses. A `LIVE=1` suite (`pnpm --filter @riff/catalog test:live`) checks the real upstreams to catch mapping drift.
  - Aggregator tests with fake adapters: timeout, failure, interleave, dedupe, `sources` statuses.
  - Cache tests: TTL expiry, LRU eviction, single-flight.
- **`api`:** route tests via `app.request()` against a real Postgres database, `riff_test`, truncated between tests, with a stubbed catalog. They cover the auth guard, likes idempotency, playlist ordering and reorder, history, the home fallback, and error mapping.
- **`web`:**
  - Vitest + Testing Library for the player (engine, store, persistence, Media Session, shortcuts), the query hooks and the components, with `fetch` stubbed.
  - Playwright against a production build and `riff_test`: the smoke test tagged `@live` (uses real Audius): sign up → search "lofi" → play the first result → `currentTime` advances → like → it appears in Liked Songs. Also a `@live` playlist keyboard-reorder test, and offline checks for the sign-in redirect and 360 px layouts.
- **Commands:** `pnpm test` runs the unit and API tests; `pnpm test:e2e` runs Playwright.

## 12. Environments

### Local development

- **Database setup:** a `riff` role owns the `riff` and `riff_test` databases on the native Postgres 16 cluster (port 5432). One-time `sudo -u postgres psql …`, documented in the README.
- **Commands:** `pnpm install` → `cp .env.example .env` → `pnpm db:migrate` → `pnpm dev` (http://localhost:3000).

### Environment variables

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgres://riff:riff@localhost:5432/riff`; the Neon pooled URL in production |
| `BETTER_AUTH_SECRET` | 32+ random bytes |
| `BETTER_AUTH_URL` | `http://localhost:3000` / production URL |
| `ALLOW_SIGNUPS` | default `true` |
| `AUDIUS_API_URL` | default `https://api.audius.co` |
| `AUDIUS_APP_NAME` | default `riff` |
| `JAMENDO_CLIENT_ID` | optional; enables Jamendo |
| `RADIO_BROWSER_SERVERS` | optional comma list; default `de1,de2` mirrors |
| `VERCEL_URL`, `VERCEL_BRANCH_URL` | set by Vercel; a preview trusts its own URLs for sign-in |

### Production

- Neon project on **Postgres 16**; Vercel project with root `apps/web`.
- Migrations are run explicitly (`pnpm db:migrate` with Neon's direct, non-pooled URL), never during the build.

## 13. Roadmap

- **v1.1:**
  - Offline downloads (service worker + Cache Storage for audio, IndexedDB for metadata; PWA install)
  - Gapless playback and crossfade (two audio elements)
  - 10-band EQ (Web Audio `BiquadFilterNode`s)
  - Import a Spotify playlist export by fuzzy-matching against the catalog
- **v2:**
  - Expo app reusing `core` and the typed client, with `react-native-track-player` for background audio and the Better Auth Expo plugin
  - Cross-device "continue listening" (player state in the DB)
- **Later:**
  - Listening parties (WebSocket)
  - Recommendations using BPM, key and mood
  - Scrobbling to ListenBrainz/Last.fm
  - PowerSync/ElectricSQL for offline-first mobile

## 14. Risks

| Risk | Mitigation |
|---|---|
| Audius API changes or outages | Adapter isolation, fixtures that catch mapping drift, DB snapshots so the library still renders, caching, and mirror fallback |
| Catalog skews independent/electronic | Accepted; Jamendo + radio broaden it; more adapters later |
| Signed stream URLs expire mid-track | Re-resolve and resume on error (§8) |
| Unknown upstream rate limits | Caching + single-flight; a descriptive User-Agent on Radio Browser and LRCLIB |
| Toolchain churn (Next 16, TS 7, Vitest 5) | Pin exact versions at scaffold; use the TypeScript version Next.js supports |
