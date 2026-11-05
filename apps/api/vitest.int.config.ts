import { defineConfig } from 'vitest/config';

// API integration suite: `test/integration/<feature>.int-spec.ts` against a real PostgreSQL
// (decision 0005 section 6; decision 0007 section 13, test rule). The owner runs it:
//
//   pnpm dev:infra                                   # if the local stack is down
//   pnpm --filter @kd/api test:int                   # the whole suite
//   pnpm --filter @kd/api test:int outbox            # optional: only files whose path matches
//
// One worker and one database: every file runs serially (`--maxWorkers=1 --no-file-parallelism`
// in the `test:int` script, decision 0002 section 1, repeated below so a bare `vitest run --config`
// cannot run files in parallel) against `TEST_DATABASE_NAME` (default `kd_scratch`). The global
// setup refuses an unsafe target, empties the database's own objects in `public` and runs the real
// migration runner, so every run starts clean. Never watch.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.int-spec.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    watch: false,
    maxWorkers: 1,
    fileParallelism: false,
    // A real database and a booted Nest app: generous, so a slow first connection is not a failure.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
