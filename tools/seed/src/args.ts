import { parseArgs } from 'node:util';

import type { AppEnv } from './environment.js';
import { VERIFY_SCOPES } from './verify.js';
import type { VerifyScope } from './verify.js';

/**
 * The accepted modes: one row each. A13-T1 to A13-T3 add `images` here, with the options they need
 * (`--file`, `--dir`) in `OPTIONS` below. `verify <scope>` is a separate command (A4-T5,
 * api-divergences D-123): it reads only, so it takes no `--commit` and runs in every `APP_ENV`.
 */
export const MODES = {
  reference: {
    summary: 'Provinces, wards, default settings, placeholder Terms and Privacy, the first ADMIN',
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
  | { readonly kind: 'run'; readonly mode: SeedMode; readonly commit: boolean }
  | { readonly kind: 'verify'; readonly scope: VerifyScope };

/** The checks of each `verify` scope; A13-T4 adds the others. */
export const VERIFY_SCOPE_SUMMARIES: Readonly<Record<VerifyScope, string>> = {
  reference:
    'Province and ward counts, the eight settings, the current consent documents, one ADMIN',
};

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function isSeedMode(value: string): value is SeedMode {
  return Object.hasOwn(MODES, value);
}

function isVerifyScope(value: string): value is VerifyScope {
  return (VERIFY_SCOPES as readonly string[]).includes(value);
}

const scopeLines = VERIFY_SCOPES.map(
  (scope) => `  ${scope.padEnd(10)}  ${VERIFY_SCOPE_SUMMARIES[scope]}`,
).join('\n');

const modeLines = Object.entries(MODES)
  .map(([name, mode]) => `  ${name.padEnd(10)}  ${mode.summary}`)
  .join('\n');

export const USAGE = `Usage: node dist/cli.js <mode> [--commit]
       node dist/cli.js verify <scope>

Modes:
${modeLines}

Verify scopes (read only; one line per check, ok or FAIL):
${scopeLines}

Options:
  --commit    Write the changes; without it the run is a dry run that writes nothing
  -h, --help  Show this help (needs no database and no configuration)

Environment:
  APP_ENV (dev|test|demo|prod), and DATABASE_URL (container) or DATABASE_URL_MIGRATOR (host),
  not both. The demo mode is refused when APP_ENV is prod. The reference mode reads
  SEED_ADMIN_EMAIL and SEED_ADMIN_NAME for the first ADMIN (both or neither), and
  SEED_CONSENT_DOCUMENTS_FILE, the absolute path of the real Terms and Privacy (else placeholders).

Exit codes:
  0  success, including "nothing to apply"
  1  runtime failure: connection, SQL error (that transaction is rolled back), unexpected error
  2  usage: unknown mode, option or argument
  3  configuration invalid, or a mode refused for this APP_ENV
  4  preflight or integrity check failed, or a verify check failed`;

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
  if (mode === 'verify') {
    return parseVerify(rest, parsed.values.commit === true);
  }
  if (rest.length > 0) {
    throw new UsageError(`unexpected argument: ${rest[0]}`);
  }
  if (!isSeedMode(mode)) {
    throw new UsageError(`unknown mode: ${mode}`);
  }
  return { kind: 'run', mode, commit: parsed.values.commit === true };
}

function parseVerify(rest: readonly string[], commit: boolean): SeedCommand {
  const [scope, ...extra] = rest;
  if (commit) {
    throw new UsageError('verify reads only and takes no --commit');
  }
  if (scope === undefined) {
    throw new UsageError('missing verify scope');
  }
  if (extra.length > 0) {
    throw new UsageError(`unexpected argument: ${extra[0]}`);
  }
  if (!isVerifyScope(scope)) {
    throw new UsageError(`unknown verify scope: ${scope}`);
  }
  return { kind: 'verify', scope };
}

function parse(argv: readonly string[]) {
  return parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: true });
}
