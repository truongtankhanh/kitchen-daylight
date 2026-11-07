/**
 * The pieces shared by every step of a seed mode: the one `pg` method a step uses, the counts of
 * one table and the step contract (plan, apply, report line). A13 and the vocabulary tasks (A5-T1,
 * A6-T4) add their steps to the lists of `steps/index.ts`.
 */

/** The subset of `pg.Client` the steps use, so a spec can pass a fake that records statements. */
export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
}

/** What a step would do, or did, to one table. Stale rows are reported, never deleted. */
export interface TableCounts {
  readonly table: string;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly stale: number;
  /** The first stale codes (public reference codes, never personal data), for the report. */
  readonly staleSample: readonly string[];
}

export interface SeedStep {
  readonly name: string;
  /** Reads the database and the source files; writes nothing. */
  plan(client: SqlClient): Promise<readonly TableCounts[]>;
  /**
   * Runs the writes inside the runner's transaction and returns, per table, the number of rows the
   * statements changed. The runner compares it with the plan.
   */
  apply(client: SqlClient): Promise<ReadonlyMap<string, number>>;
}

/** A source file or a database state that breaks a rule the step relies on: exit 4. */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

/** How many stale codes a report line lists. */
export const STALE_SAMPLE_SIZE = 10;

/** One report line per table, for example `geography  wards  inserted 3 ... stale 1 (90009)`. */
export function reportLine(step: string, counts: TableCounts): string {
  const stale =
    counts.stale === 0
      ? 'stale 0'
      : `stale ${counts.stale} (${counts.staleSample.join(', ')}${counts.stale > counts.staleSample.length ? ', ...' : ''})`;
  return [
    step,
    counts.table,
    `inserted ${counts.inserted}`,
    `updated ${counts.updated}`,
    `unchanged ${counts.unchanged}`,
    stale,
  ].join('  ');
}
