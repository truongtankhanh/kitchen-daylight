import type { TestProject } from 'vitest/node';

import { EXIT } from '../../src/cli/exit-codes.js';
import { runMigrate } from '../../src/cli/migrate.js';
import { readEnvironment } from '../../src/config/env-file.js';
import { loadConfig } from '../../src/config/load-config.js';
import { MIGRATIONS_DIR } from '../../src/database/data-source.js';
import {
  describeTestDatabase,
  resetTestDatabase,
  resolveTestDatabase,
  ROOT_ENV_FILE,
} from './test-database.js';

/**
 * Runs once before the workers: checks the target (`resolveTestDatabase`), empties it, then applies
 * `migrations/` with the real runner (`runMigrate`, the code of `pnpm migrate`). Every run starts
 * clean, so an unmerged migration edited between runs is not blocked by the checksum guard.
 * The URLs reach the workers through `provide` only; they are never printed.
 */
export default async function setup(project: TestProject): Promise<void> {
  // The process environment wins over the file (decision 0005, section 3).
  const urls = resolveTestDatabase(readEnvironment(ROOT_ENV_FILE, process.env));
  const target = describeTestDatabase(urls);

  await resetTestDatabase(urls);

  const config = loadConfig({ APP_ENV: 'test', DATABASE_URL_MIGRATOR: urls.migratorUrl }, 'cli');
  const code = await runMigrate(config, MIGRATIONS_DIR);
  if (code !== EXIT.OK) {
    throw new Error(`integration: migrate exited with code ${code} on ${target}`);
  }

  project.provide('kdTestDatabase', urls);
}
