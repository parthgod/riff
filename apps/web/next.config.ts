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
