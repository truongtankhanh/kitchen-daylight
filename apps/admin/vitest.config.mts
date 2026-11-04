import { defineConfig } from 'vitest/config';

// Base config passed to `ng test` through `runnerConfig` in angular.json. The worker cap of
// decision 0002 lives here because `ng test` has no worker flag. `ng test --no-watch` runs once.
export default defineConfig({
  test: {
    maxWorkers: 2,
  },
});
