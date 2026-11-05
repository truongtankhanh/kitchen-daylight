// Entry point of `node dist/cli.js <mode> [--commit]` (decision 0005 sections 8 and 9; run from
// `/app` in the API image as `node seed/dist/cli.js`). The environment comes from the process:
// the `seed` script loads the root `.env` with `--env-file-if-exists` (decision 0005 section 3);
// a container has no `.env`.
import { MODES, parseSeedArgs, USAGE, UsageError } from './args.js';
import { assertModeAllowed, ConfigError, readSeedConfig } from './environment.js';
import type { Environment } from './environment.js';
import { EXIT } from './exit-codes.js';
import type { ExitCode } from './exit-codes.js';

async function main(argv: readonly string[], env: Environment): Promise<ExitCode> {
  let command;
  try {
    command = parseSeedArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`seed: ${error.message}\n\n${USAGE}`);
      return EXIT.USAGE;
    }
    throw error;
  }

  if (command.kind === 'help') {
    console.log(USAGE);
    return EXIT.OK;
  }

  try {
    const config = readSeedConfig(env);
    assertModeAllowed(command.mode, MODES[command.mode].appEnvs, config.appEnv);
  } catch (error) {
    if (error instanceof ConfigError) {
      // Names and rules only, never a value.
      console.error(error.message);
      return EXIT.CONFIG;
    }
    throw error;
  }

  // Shell only (A0-T10): no mode is implemented and no database connection is opened. Exit 2 is
  // the usage code of the table, kept here on purpose (owner's instruction) until the first mode
  // exists (reference: A2-T3 and A4-T5; business, images, demo and verify: A13).
  console.error(`seed ${command.mode}: not implemented yet`);
  return EXIT.USAGE;
}

main(process.argv.slice(2), process.env).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`seed: unexpected error${error instanceof Error ? ` (${error.name})` : ''}`);
    process.exitCode = EXIT.FAILURE;
  },
);
