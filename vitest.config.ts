import { defineConfig } from 'vitest/config';

// Standalone from vite.config.ts so the Devvit build plugin isn't loaded for
// unit tests. Pure logic only — node environment.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
