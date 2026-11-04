import { defineConfig } from 'vitest/config';

// Unit tests only: `*.spec.ts` next to the file they test (decision 0005, section 6).
// The worker cap lives in the `test` script (decision 0002, section 1). Never watch.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    watch: false,
    // The shell has no tests yet; remove once the first spec lands.
    passWithNoTests: true,
  },
});
