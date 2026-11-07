// Entry point of `node dist/cli.js <mode> [--commit]` (decision 0005 sections 8 and 9; run from
// `/app` in the API image as `node seed/dist/cli.js`). The environment comes from the process:
// the `seed` script loads the root `.env` with `--env-file-if-exists` (decision 0005 section 3);
// a container has no `.env`.
import { Client } from 'pg';

import { MODES, parseSeedArgs, USAGE, UsageError } from './args.js';
import type { SeedMode } from './args.js';
import { assertModeAllowed, ConfigError, readSeedConfig } from './environment.js';
import type { Environment, SeedConfig } from './environment.js';
import { EXIT } from './exit-codes.js';
import type { ExitCode } from './exit-codes.js';
import { runSteps } from './runner.js';
import { referenceSteps } from './steps/index.js';
import { IntegrityError } from './steps/step.js';
import type { SeedStep } from './steps/step.js';

/**
 * The implemented modes and their ordered steps. `reference` holds geography (A2-T3); A4-T5 adds
 * settings, consent documents and the first ADMIN. `business` and `demo` arrive with A13.
 */
const STEPS: Partial<Record<SeedMode, () => readonly SeedStep[]>> = {
  reference: referenceSteps,
};

/** `SQLSTATE` or Node error code of a failure, never its message (it may name a host or a role). */
function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? ` ${code}` : '';
}

async function run(
  mode: SeedMode,
  steps: readonly SeedStep[],
  config: SeedConfig,
  commit: boolean,
): Promise<ExitCode> {
  console.log(
    `seed ${mode}: ${commit ? 'commit' : 'dry run (rolled back at the end; --commit writes)'}`,
  );
  const client = new Client({ connectionString: config.databaseUrl, application_name: 'kd-seed' });
  try {
    await client.connect();
    await runSteps(client, steps, { commit, report: (line) => console.log(`  ${line}`) });
    console.log(`seed ${mode}: ${commit ? 'committed' : 'rolled back (dry run)'}`);
    return EXIT.OK;
  } catch (error) {
    if (error instanceof IntegrityError) {
      console.error(`seed ${mode}: ${error.message}; nothing was written`);
      return EXIT.INTEGRITY;
    }
    const name = error instanceof Error ? error.name : 'error';
    console.error(`seed ${mode}: ${name}${errorCodeOf(error)}; nothing was written`);
    return EXIT.FAILURE;
  } finally {
    await client.end().catch(() => undefined);
  }
}

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

  let config: SeedConfig;
  try {
    config = readSeedConfig(env);
    assertModeAllowed(command.mode, MODES[command.mode].appEnvs, config.appEnv);
  } catch (error) {
    if (error instanceof ConfigError) {
      // Names and rules only, never a value.
      console.error(error.message);
      return EXIT.CONFIG;
    }
    throw error;
  }

  const steps = STEPS[command.mode];
  if (steps === undefined) {
    // Exit 2, the usage code of the table, kept on purpose (owner's instruction, A0-T10) until the
    // mode exists (business, images, demo and verify: A13). No database connection is opened.
    console.error(`seed ${command.mode}: not implemented yet`);
    return EXIT.USAGE;
  }
  return run(command.mode, steps(), config, command.commit);
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
