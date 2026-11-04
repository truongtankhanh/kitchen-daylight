import { parseArgs } from 'node:util';

export type CliCommand = { readonly kind: 'help' } | { readonly kind: 'migrate' };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const USAGE = `Usage: node dist/cli.js <command> [options]

Commands:
  migrate     Run the preflight, then apply the pending SQL migrations as kd_migrator

Options:
  -h, --help  Show this help (needs no database and no configuration)

Environment:
  APP_ENV, and DATABASE_URL (container) or DATABASE_URL_MIGRATOR (host), not both

Exit codes:
  0  success, including "nothing to apply"
  1  runtime failure: connection, SQL error (that file is rolled back), unexpected error
  2  usage: unknown command, option or argument
  3  configuration invalid
  4  preflight or integrity check failed`;

/** Parses the arguments after `node dist/cli.js`. Throws `UsageError`. */
export function parseCliArgs(argv: readonly string[]): CliCommand {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'invalid arguments');
  }

  if (parsed.values.help === true) {
    return { kind: 'help' };
  }

  const [command, ...rest] = parsed.positionals;
  if (command === undefined) {
    throw new UsageError('missing command');
  }
  if (rest.length > 0) {
    throw new UsageError(`unexpected argument: ${rest[0]}`);
  }
  if (command === 'migrate') {
    return { kind: 'migrate' };
  }
  throw new UsageError(`unknown command: ${command}`);
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    options: { help: { type: 'boolean', short: 'h' } },
    strict: true,
    allowPositionals: true,
  });
}
