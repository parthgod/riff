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

<!-- dgc-policy-v11 -->
# Dual-Graph Context Policy

This project uses a local dual-graph MCP server for efficient context retrieval.

## MANDATORY: Always follow this order

1. **Call `graph_continue` first** — before any file exploration, grep, or code reading.

2. **If `graph_continue` returns `needs_project=true`**: call `graph_scan` with the
   current project directory (`pwd`). Do NOT ask the user.

3. **If `graph_continue` returns `skip=true`**: project has fewer than 5 files.
   Do NOT do broad or recursive exploration. Read only specific files if their names
   are mentioned, or ask the user what to work on.

4. **Read `recommended_files`** using `graph_read` — **one call per file**.
   - `graph_read` accepts a single `file` parameter (string). Call it separately for each
     recommended file. Do NOT pass an array or batch multiple files into one call.
   - `recommended_files` may contain `file::symbol` entries (e.g. `src/auth.ts::handleLogin`).
     Pass them verbatim to `graph_read(file: "src/auth.ts::handleLogin")` — it reads only
     that symbol's lines, not the full file.
   - Example: if `recommended_files` is `["src/auth.ts::handleLogin", "src/db.ts"]`,
     call `graph_read(file: "src/auth.ts::handleLogin")` and `graph_read(file: "src/db.ts")`
     as two separate calls (they can be parallel).

5. **Check `confidence` and obey the caps strictly:**
   - `confidence=high` -> Stop. Do NOT grep or explore further.
   - `confidence=medium` -> If recommended files are insufficient, call `fallback_rg`
     at most `max_supplementary_greps` time(s) with specific terms, then `graph_read`
     at most `max_supplementary_files` additional file(s). Then stop.
   - `confidence=low` -> Call `fallback_rg` at most `max_supplementary_greps` time(s),
     then `graph_read` at most `max_supplementary_files` file(s). Then stop.

## Token Usage

A `token-counter` MCP is available for tracking live token usage.

- To check how many tokens a large file or text will cost **before** reading it:
  `count_tokens({text: "<content>"})`
- To log actual usage after a task completes (if the user asks):
  `log_usage({input_tokens: <est>, output_tokens: <est>, description: "<task>"})`
- To show the user their running session cost:
  `get_session_stats()`

Live dashboard URL is printed at startup next to "Token usage".

## Rules

- Do NOT use `rg`, `grep`, or bash file exploration before calling `graph_continue`.
- Do NOT do broad/recursive exploration at any confidence level.
- `max_supplementary_greps` and `max_supplementary_files` are hard caps - never exceed them.
- Do NOT dump full chat history.
- Do NOT call `graph_retrieve` more than once per turn.
- After edits, call `graph_register_edit` with the changed files. Use `file::symbol` notation (e.g. `src/auth.ts::handleLogin`) when the edit targets a specific function, class, or hook.

## Context Store

Whenever you make a decision, identify a task, note a next step, fact, or blocker during a conversation, call `graph_add_memory`.

**To add an entry:**
```
graph_add_memory(type="decision|task|next|fact|blocker", content="one sentence max 15 words", tags=["topic"], files=["relevant/file.ts"])
```

**Do NOT write context-store.json directly** — always use `graph_add_memory`. It applies pruning and keeps the store healthy.

**Rules:**
- Only log things worth remembering across sessions (not every minor detail)
- `content` must be under 15 words
- `files` lists the files this decision/task relates to (can be empty)
- Log immediately when the item arises — not at session end

## Session End

When the user signals they are done (e.g. "bye", "done", "wrap up", "end session"), proactively update `CONTEXT.md` in the project root with:
- **Current Task**: one sentence on what was being worked on
- **Key Decisions**: bullet list, max 3 items
- **Next Steps**: bullet list, max 3 items

Keep `CONTEXT.md` under 20 lines total. Do NOT summarize the full conversation — only what's needed to resume next session.
