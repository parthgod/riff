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
