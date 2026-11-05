/**
 * Exit codes of `node dist/cli.js`: the table of decision 0005 section 8, repeated here because
 * `@kd/seed` imports nothing from `apps/api` (decision 0003 section 6).
 */
export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  CONFIG: 3,
  INTEGRITY: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
