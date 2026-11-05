import { parseArgs } from 'node:util';

import type { AppEnv } from './environment.js';

/**
 * The accepted modes: one row each. A13-T1 to A13-T4 add `images` and `verify` here, with the
 * options they need (`--file`, `--dir`) in `OPTIONS` below.
 */
export const MODES = {
  reference: {
    summary: 'Provinces, wards, tags, default app settings, email templates, the first ADMIN',
    appEnvs: ['dev', 'test', 'demo', 'prod'],
  },
  business: {
    summary: 'Branches, hours, zones, tables and the menu from the owner-supplied files',
    appEnvs: ['dev', 'test', 'demo', 'prod'],
  },
  demo: {
    // Synthetic customers and orders: never in prod (migration-plan principle 6). The Docker test
    // stack runs it with APP_ENV=test (owner decision 2026-11-05, decision 0007 amends 0005 s. 8).
    summary: 'Synthetic customers, orders, reservations and reviews (not in prod)',
    appEnvs: ['dev', 'test', 'demo'],
  },
} as const satisfies Record<string, { summary: string; appEnvs: readonly AppEnv[] }>;

export type SeedMode = keyof typeof MODES;

/** The options of every mode. Dry run is the default: writing needs `--commit`. */
const OPTIONS = {
  commit: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export type SeedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'run'; readonly mode: SeedMode; readonly commit: boolean };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function isSeedMode(value: string): value is SeedMode {
  return Object.hasOwn(MODES, value);
}

const modeLines = Object.entries(MODES)
  .map(([name, mode]) => `  ${name.padEnd(10)}  ${mode.summary}`)
  .join('\n');

export const USAGE = `Usage: node dist/cli.js <mode> [--commit]

Modes:
${modeLines}

Options:
  --commit    Write the changes; without it the run is a dry run that writes nothing
  -h, --help  Show this help (needs no database and no configuration)

Environment:
  APP_ENV (dev|test|demo|prod), and DATABASE_URL (container) or DATABASE_URL_MIGRATOR (host),
  not both. The demo mode is refused when APP_ENV is prod.

Exit codes:
  0  success, including "nothing to apply"
  1  runtime failure: connection, SQL error (that transaction is rolled back), unexpected error
  2  usage: unknown mode, option or argument
  3  configuration invalid, or a mode refused for this APP_ENV
  4  preflight or integrity check failed`;

/** Parses the arguments after `node dist/cli.js` (decision 0005 section 8). Throws `UsageError`. */
export function parseSeedArgs(argv: readonly string[]): SeedCommand {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'invalid arguments');
  }

  if (parsed.values.help === true) {
    return { kind: 'help' };
  }

  const [mode, ...rest] = parsed.positionals;
  if (mode === undefined) {
    throw new UsageError('missing mode');
  }
  if (rest.length > 0) {
    throw new UsageError(`unexpected argument: ${rest[0]}`);
  }
  if (!isSeedMode(mode)) {
    throw new UsageError(`unknown mode: ${mode}`);
  }
  return { kind: 'run', mode, commit: parsed.values.commit === true };
}

function parse(argv: readonly string[]) {
  return parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: true });
}
