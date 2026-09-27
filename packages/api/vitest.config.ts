import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test file truncates the shared riff_test database, so files run one at a time.
    fileParallelism: false,
    globalSetup: ['./src/testing/global-setup.ts'],
  },
});
