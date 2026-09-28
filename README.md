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
