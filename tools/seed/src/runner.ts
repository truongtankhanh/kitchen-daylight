import { IntegrityError, reportLine } from './steps/step.js';
import type { SeedStep, SqlClient, TableCounts } from './steps/step.js';

/**
 * Serializes seed runs on one database: a second run waits for the first to commit or roll back,
 * then plans against its result. Transaction-scoped, so it ends with the transaction.
 */
export const SEED_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('kd.seed'))";

export interface RunOptions {
  /** `--commit`: commit the transaction. Without it the same statements run and are rolled back. */
  readonly commit: boolean;
  /** One line per table and step, then the outcome line. */
  readonly report: (line: string) => void;
}

export interface RunResult {
  readonly counts: readonly { readonly step: string; readonly counts: TableCounts }[];
  readonly committed: boolean;
}

/**
 * Runs the steps in order inside one transaction (decision 0005 section 8; migration-plan
 * principles 2 and 3). For each step: plan, apply, then check that every table changed exactly the
 * planned `inserted + updated` rows, else `IntegrityError` (exit 4). A dry run executes the same
 * SQL and rolls it back; `commit` commits. Any error rolls back and is rethrown.
 */
export async function runSteps(
  client: SqlClient,
  steps: readonly SeedStep[],
  options: RunOptions,
): Promise<RunResult> {
  const results: { step: string; counts: TableCounts }[] = [];
  await client.query('BEGIN');
  try {
    await client.query(SEED_LOCK_SQL);
    for (const step of steps) {
      const planned = await step.plan(client);
      const applied = await step.apply(client);
      for (const counts of planned) {
        const changed = applied.get(counts.table) ?? 0;
        if (changed !== counts.inserted + counts.updated) {
          throw new IntegrityError(
            `${step.name}: ${counts.table} changed ${changed} rows, the plan expected ${counts.inserted + counts.updated}`,
          );
        }
        results.push({ step: step.name, counts });
        options.report(reportLine(step.name, counts));
      }
    }
    await client.query(options.commit ? 'COMMIT' : 'ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return { counts: results, committed: options.commit };
}
