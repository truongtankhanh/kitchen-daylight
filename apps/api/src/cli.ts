// Entry point of `dist/cli.js` (decision 0005, section 8). Never boots the Nest application.
import { parseCliArgs, USAGE, UsageError } from './cli/args.js';
import { EXIT } from './cli/exit-codes.js';
import type { ExitCode } from './cli/exit-codes.js';
import { runMigrate } from './cli/migrate.js';
import { readEnvironment } from './config/env-file.js';
import { ConfigValidationError, loadConfig } from './config/load-config.js';
import type { CliConfig } from './config/load-config.js';

// The repository root `.env` (decision 0005, section 3), resolved from `dist/` and `src/` alike.
const ROOT_ENV_FILE = new URL('../../../.env', import.meta.url);

async function main(argv: readonly string[]): Promise<ExitCode> {
  let command;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`cli: ${error.message}\n\n${USAGE}`);
      return EXIT.USAGE;
    }
    throw error;
  }

  if (command.kind === 'help') {
    console.log(USAGE);
    return EXIT.OK;
  }

  let config: CliConfig;
  try {
    config = loadConfig(readEnvironment(ROOT_ENV_FILE, process.env), 'cli');
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      // Names and rules only, never a value (decision 0005, section 4).
      console.error(error.message);
      return EXIT.CONFIG;
    }
    throw error;
  }

  return runMigrate(config);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`cli: unexpected error${error instanceof Error ? ` (${error.name})` : ''}`);
  process.exitCode = EXIT.FAILURE;
}
