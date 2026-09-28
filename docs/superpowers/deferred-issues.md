# Deferred issues

Issues the plan reviews found and deliberately left unfixed, kept here so they aren't lost. Each entry says what goes wrong and where. Numbers match the review that found them, so "Plan 2 #5" stays a stable reference.

When you fix one, mark it fixed with the commit in the same change (as Plan 1 #5 and #6 are), or delete it.

## Plan 1: core and catalog (`packages/core`, `packages/catalog`)

From the final review on 2026-09-27.

1. **Lyrics matching** picks the first synced match within ±3 s rather than the closest one (LRCLIB `pickBest`).
2. **The lyrics parser** treats a time like `[10:30]` in the middle of a line as a timestamp, and stripping word tags can leave double spaces (`parseLrc`).
3. **Duplicate matching** doesn't strip "featuring" credits, and titles made only of emoji normalise to an empty string, so they can wrongly count as duplicates (`normalizeForMatch`).
4. **Search cache keys** aren't whitespace-collapsed or NFC-normalised, so searches differing only in spacing or accent encoding aren't shared in the cache. That costs only extra calls to the source, and the web client already collapses whitespace before searching.
5. ~~Starting a queue with an invalid (NaN) start position corrupts the queue.~~ Fixed in Plan 3 Task 1 (`7c991af`).
6. ~~With shuffle and repeat-all on, a new round can open with the track that just played before a queued song.~~ Fixed in Plan 3 Task 1 (`7c991af`).
7. **Audius playlist counts:** a collection's `trackCount` is the source's count (e.g. 10) while `tracks` lists only the playable ones (e.g. 9). The web collection page counts the tracks it shows.
8. **Unknown Audius artist:** an unknown artist id gives an error (502) instead of an empty list for their tracks and related artists (`getArtistTracks`, `getRelatedArtists`).
9. **Error-logging callback:** if `onSourceError` itself throws, the whole search fails.
10. **The real-API suite** can't detect playlist format changes: its `Array.isArray(collection.tracks)` check passes for any array.
11. **Queue test coverage:** queue tests don't cover shuffle and repeat combined with queued songs. The reviewer's probes found no bugs there, and Plan 3 Task 1 added the wrap case.

## Plan 2: database and API (`packages/db`, `packages/api`)

From the final review on 2026-09-27.

1. **Mixed-case ids:** the same id spelled two ways in one request returns 500 (e.g. a radio station id in upper and lower case). Unliking with a differently spelled id silently does nothing (`library/snapshots.ts`, `routes/likes.ts`).
2. **Blank optional parameters** (`?genre=`, `?tag=`, an empty history `context`) return 400 instead of being treated as unset. The web client never sends them.
3. **Better Auth's responses** (`/api/auth/*`) don't carry `Cache-Control: no-store`.
4. **Better Auth errors in the session check:** a Better Auth `APIError` thrown by `getSession` becomes a 500 instead of its own status.
5. **One slow Home section**, such as waiting up to 8 s on an artist lookup for "New from artists you follow", delays the whole of `/home`. The fix is a deadline per section; the web client shows skeletons meanwhile.
6. **Id length:** track and artist ids have no maximum length.
7. **Upstream failures aren't logged:** 502 and 504 failures on single-entity routes aren't passed to the `onError` hook.
8. **5xx messages:** a 5xx `HTTPException` thrown by Hono itself passes its message through to the client.
9. **Adding many tracks at once:** adding 100 ids fires 100 parallel `getTrack` calls, so one upstream 429 fails the whole add. The fix is bounded concurrency; the web UI adds one track at a time.

## Plan 3: web app (`apps/web`)

From the final review on 2026-09-28. Its seven Important findings were fixed before the merge; these are the Minor ones. Paths are relative to `apps/web` unless noted.

1. **Stall check on a playing track:** `restart()` (Previous after 3 s, repeat one) arms the 15 s stall watchdog even while the element is already playing. Harmless in Chrome, where the seek fires `waiting` then `playing`; an element that fires neither would switch to a mirror after 15 s (`lib/player/engine.ts`, `lib/player/player.ts`).
2. **Play after an error on the last track** calls `play()` on the dead source: 15 s of silence, then "Couldn’t play … Skipping." It should load the track again (`lib/player/player.ts`).
3. **Previous on a restored player:** after a reload, Previous past 3 s resets the position to 0 but plays nothing, because no audio is loaded yet (`lib/player/player.ts`).
4. **Saving the queue:** a failed save (full storage) leaves the older `riff:player:v1` in place, so a reload restores an old queue. The whole queue (`original` and `order`) is also re-serialised every 5 s while playing, which is heavy for contexts with thousands of tracks (`lib/player/persistence.ts`).
5. **History edge cases:** any heard time is recorded when a track ends, even for a long track the listener skipped to the end of (the spec records on `ended` only for tracks shorter than 30 s). A `search:<query>` context longer than 200 characters is rejected by the API, so that play is lost (`lib/player/play-tracker.ts`, `lib/player/player.ts`).
6. **Unencoded route params:** route params go into typed-client paths unencoded, so `/artist/..%2Fme%2Flikes` makes the page GET `/api/me/likes` and render it as an artist. GET only and the user's own data, so low risk. Encode or validate ids (`lib/route-param.ts`, `lib/queries/catalog.ts`).
7. **Radio station links:** a station's `permalink` is its community-edited homepage and isn't checked to be http(s) (React 19 and `noopener` make it harmless today). "Open on Radio Browser" also opens the station's own site, not Radio Browser (`packages/catalog/src/sources/radio/map.ts`, `components/tracks/track-menu.tsx`).
8. **Playing row matched by track, not queue item:** a track that appears twice in a list highlights twice, and clicking the playing track in another list pauses it instead of playing that list (`components/tracks/track-list.tsx`).
9. **An e2e test name overclaims:** "signed-out visitors are sent to sign-in and brought back after" never signs in or checks the return trip (`e2e/layout.spec.ts`).
10. **Lock-screen progress:** the Media Session position state isn't cleared when a live station starts, so the previous track's progress can linger (`lib/player/media-session.ts`).
11. **Liked Songs page error:** a failed next-page fetch replaces the whole list with the error state (`app/(app)/liked/page.tsx`).
12. **Play on a finished list:** the big Play button on a list that has finished (status `ended`) replays only its last track, not the list from the top (`components/tracks/play-context-button.tsx`).
13. **Queue panel not virtualised:** a 2,000-track queue (e.g. Liked Songs) mounts 2,000 rows when the panel opens (`components/player/queue-panel.tsx`).

### Decisions to revisit

These behaviours were kept on purpose; each needs a decision rather than a quick fix.

- **Offline failover.** When the network drops mid-track, the player tries the mirrors and one fresh resolution, then skips, and it stops after 3 failures in a row (spec §8). On a flaky phone connection that advances the queue by up to two tracks and loses the position. Candidate: stop in place when offline, or when the fresh resolution fails with a network error. Each source also gets its own 15 s stall timeout, so a track whose sources all stall can spin for over a minute; consider a cap per track.
- **iOS Safari first play (unverified).** Safari may block `play()` when it follows the awaited stream lookup. Check on a device; if it's blocked, the first tap doesn't start audio and a second tap does.
- **Two tabs** both write `riff:player:v1`, and the tab that saved last wins after a reload.
- **Accepted for a single-owner app:** a session that expires mid-song sends the listener to sign in (spec §10); whoever signs in after an expiry sees the previous queue, paused (signing out clears it); plain-http access over a LAN IP isn't supported, because the auth settings pin the app to `BETTER_AUTH_URL`.
- **Before deploying:** check Neon's pooled URL with postgres.js prepared statements, and consider security headers (CSP). Sign-in has no rate limit beyond Better Auth's defaults, which live in memory and so apply per Vercel instance; rate limiting is a spec non-goal, and `ALLOW_SIGNUPS=false` is the main protection. The README's Vercel steps haven't been tried on a real deploy.

### Observed limitations

- **First-play latency:** `/api/stream/:id` takes about 1 s against Audius (a track lookup, then the stream URL), which already spends the spec's ≤ 1 s start target. Prefetch hides it for every following track. A fix could have the catalog cache the tracks that search and trending return, so resolving a stream skips the lookup.
- **Radio Browser's top list** follows whichever region clicks most (mostly Lagos stations on 2026-09-28); a country or tag default would help. Many station logos are tiny or broken, and tiles fall back to a placeholder.
- **Live e2e tests depend on Audius.** When Audius is slow (8 s upstream timeouts), the `@live` smoke or playlist test can fail; rerun, or skip them with `--grep-invert @live`.
- **E2E sign-ups:** the suite signs up 3 times, the most Better Auth's production limit allows in 10 s, so a new e2e test should reuse an existing sign-up.
