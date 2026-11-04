import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import type { CliConfig } from '../config/load-config.js';
import {
  createDataSourceOptions,
  describeDatabaseTarget,
  MIGRATIONS_DIR,
} from '../database/data-source.js';
import { EXIT } from './exit-codes.js';
import type { ExitCode } from './exit-codes.js';
import { hasNoTransactionMarker, planMigrations } from './migrations.js';
import type { AppliedMigration, PlannedMigration } from './migrations.js';
import {
  evaluatePreflight,
  PREFLIGHT_QUERY,
  REQUIRED_EXTENSIONS,
  toPreflightFacts,
} from './preflight.js';

/** Session advisory lock shared by every `migrate` run, so a second runner waits. */
const LOCK_KEY = '4851203117';

/** The runner's own bookkeeping (decision 0005, section 7), not a schema migration. */
const ENSURE_HISTORY_TABLE = `CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

/**
 * `migrate`: connect as `kd_migrator`, run the preflight, then apply the pending `.sql` files
 * in version order. Prints `host:port/database` at most, never the connection URL.
 */
export async function runMigrate(
  config: CliConfig,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<ExitCode> {
  const url = config.database.url;
  const dataSource = new DataSource(createDataSourceOptions(config));
  try {
    await dataSource.initialize();
  } catch (error) {
    console.error(`migrate: cannot connect to ${describeDatabaseTarget(url)}${codeOf(error)}`);
    return EXIT.FAILURE;
  }

  const runner = dataSource.createQueryRunner();
  let current: string | undefined;
  try {
    await runner.connect();

    const rows: unknown[] = await runner.query(PREFLIGHT_QUERY, [REQUIRED_EXTENSIONS]);
    const failures = evaluatePreflight(toPreflightFacts(rows[0]));
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(`migrate: preflight: ${failure}`);
      }
      return EXIT.INTEGRITY;
    }

    await runner.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_KEY]);
    try {
      await runner.query(ENSURE_HISTORY_TABLE);
      const applied = toApplied(
        await runner.query('SELECT version, name, sha256 FROM public.schema_migrations'),
      );
      const files = await readMigrationFiles(migrationsDir);
      const plan = planMigrations([...files.values()], applied);

      if (plan.problems.length > 0) {
        for (const problem of plan.problems) {
          console.error(`migrate: integrity: ${problem}`);
        }
        return EXIT.INTEGRITY;
      }
      if (plan.pending.length === 0) {
        console.log('migrate: nothing to apply');
        return EXIT.OK;
      }

      for (const migration of plan.pending) {
        current = migration.fileName;
        await applyOne(runner, migration, files.get(migration.fileName)?.sql ?? '');
        console.log(`migrate: applied ${migration.fileName}`);
      }
      current = undefined;
      console.log(`migrate: ${plan.pending.length} applied`);
      return EXIT.OK;
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]);
    }
  } catch (error) {
    const what = current === undefined ? 'failed' : `${current} failed (rolled back)`;
    console.error(`migrate: ${what}${codeOf(error)}: ${redact(messageOf(error), url)}`);
    return EXIT.FAILURE;
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

interface MigrationSource {
  readonly fileName: string;
  readonly sha256: string;
  readonly sql: string;
}

async function readMigrationFiles(dir: string): Promise<Map<string, MigrationSource>> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const files = new Map<string, MigrationSource>();
  for (const fileName of names) {
    const sql = await readFile(join(dir, fileName), 'utf8');
    const sha256 = createHash('sha256').update(sql, 'utf8').digest('hex');
    files.set(fileName, { fileName, sha256, sql });
  }
  return files;
}

async function applyOne(
  runner: QueryRunner,
  migration: PlannedMigration,
  sql: string,
): Promise<void> {
  const record = () =>
    runner.query(
      'INSERT INTO public.schema_migrations (version, name, sha256) VALUES ($1, $2, $3)',
      [migration.version, migration.name, migration.sha256],
    );

  if (hasNoTransactionMarker(sql)) {
    await runner.query(sql);
    await record();
    return;
  }

  await runner.startTransaction();
  try {
    await runner.query(sql);
    await record();
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction().catch(() => undefined);
    throw error;
  }
}

function toApplied(rows: unknown): AppliedMigration[] {
  return (rows as { version: number; name: string; sha256: string }[]).map((row) => ({
    version: Number(row.version),
    name: row.name,
    sha256: row.sha256,
  }));
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? ` (${code})` : '';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unexpected error';
}

/** Defence in depth: a driver message must never carry the URL. */
export function redact(text: string, url: string): string {
  return url === '' ? text : text.split(url).join('<database url>');
}
