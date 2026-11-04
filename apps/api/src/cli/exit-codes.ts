/** Exit codes of `dist/cli.js` (decision 0005, section 8). */
export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  CONFIG: 3,
  INTEGRITY: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
