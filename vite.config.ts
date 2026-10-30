import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true },
  build: {
    chunkSizeWarningLimit: 1500,
    // Saves name classes by constructor name (src/sim/save.ts): keep them through minification.
    rolldownOptions: { output: { keepNames: true } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
