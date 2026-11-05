import { defineConfig } from 'vitest/config';

// Unit tests only: `*.spec.ts` next to the file they test (decision 0002, section 1).
// The worker cap lives in the `test` script. Never watch.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    watch: false,
  },
});
