import { describe, expect, it } from 'vitest';

import { runSteps, SEED_LOCK_SQL } from './runner.js';
import { IntegrityError, reportLine } from './steps/step.js';
import type { SeedStep, SqlClient, TableCounts } from './steps/step.js';

function counts(table: string, overrides: Partial<TableCounts> = {}): TableCounts {
  return { table, inserted: 0, updated: 0, unchanged: 0, stale: 0, staleSample: [], ...overrides };
}

/** A client that records statements; `failOn` makes one statement reject. */
function recordingClient(failOn?: string) {
  const statements: string[] = [];
  const client: SqlClient = {
    query: async <Row>(text: string) => {
      statements.push(text);
      if (text === failOn) {
        throw Object.assign(new Error('boom'), { code: '40P01' });
      }
      return { rows: [] as Row[] };
    },
  };
  return { client, statements };
}

/** A step that issues one marker statement per phase and reports the given counts. */
function step(name: string, planned: TableCounts[], applied: Record<string, number>): SeedStep {
  return {
    name,
    plan: async (client) => {
      await client.query(`plan ${name}`);
      return planned;
    },
    apply: async (client) => {
      await client.query(`apply ${name}`);
      return new Map(Object.entries(applied));
    },
  };
}

describe('runSteps', () => {
  const first = step('first', [counts('a', { inserted: 2, updated: 1, unchanged: 4 })], { a: 3 });
  const second = step('second', [counts('b', { unchanged: 5, stale: 1, staleSample: ['x'] })], {});

  it('dry run: runs every step in order inside one transaction and rolls it back', async () => {
    const { client, statements } = recordingClient();
    const lines: string[] = [];

    const result = await runSteps(client, [first, second], {
      commit: false,
      report: (line) => lines.push(line),
    });

    expect(statements).toEqual([
      'BEGIN',
      SEED_LOCK_SQL,
      'plan first',
      'apply first',
      'plan second',
      'apply second',
      'ROLLBACK',
    ]);
    expect(result.committed).toBe(false);
    expect(lines).toEqual([
      'first  a  inserted 2  updated 1  unchanged 4  stale 0',
      'second  b  inserted 0  updated 0  unchanged 5  stale 1 (x)',
    ]);
  });

  it('--commit: the same statements, then COMMIT', async () => {
    const { client, statements } = recordingClient();

    const result = await runSteps(client, [first, second], { commit: true, report: () => {} });

    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
    expect(result.committed).toBe(true);
    expect(result.counts.map((entry) => entry.counts.table)).toEqual(['a', 'b']);
  });

  it('refuses with an IntegrityError and rolls back when a table changed other than planned', async () => {
    const { client, statements } = recordingClient();
    const drifted = step('drifted', [counts('a', { inserted: 1 })], { a: 2 });

    await expect(
      runSteps(client, [drifted, second], { commit: true, report: () => {} }),
    ).rejects.toThrow(new IntegrityError('drifted: a changed 2 rows, the plan expected 1'));
    expect(statements).toEqual([
      'BEGIN',
      SEED_LOCK_SQL,
      'plan drifted',
      'apply drifted',
      'ROLLBACK',
    ]);
  });

  it('rolls back and rethrows an SQL error, also with --commit', async () => {
    const { client, statements } = recordingClient('apply second');

    await expect(
      runSteps(client, [first, second], { commit: true, report: () => {} }),
    ).rejects.toMatchObject({ code: '40P01' });
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('runs nothing but the transaction and the lock when there is no step', async () => {
    const { client, statements } = recordingClient();

    await runSteps(client, [], { commit: false, report: () => {} });

    expect(statements).toEqual(['BEGIN', SEED_LOCK_SQL, 'ROLLBACK']);
  });
});

describe('reportLine', () => {
  it('lists the stale sample and marks a longer list', () => {
    expect(
      reportLine('geography', counts('wards', { stale: 3, staleSample: ['90001', '90002'] })),
    ).toBe('geography  wards  inserted 0  updated 0  unchanged 0  stale 3 (90001, 90002, ...)');
  });
});
