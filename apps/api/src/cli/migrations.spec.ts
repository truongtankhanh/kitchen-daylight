import { describe, expect, it } from 'vitest';

import { hasNoTransactionMarker, isMigrationFileName, planMigrations } from './migrations.js';

const file = (fileName: string, sha256 = `sha-${fileName}`) => ({ fileName, sha256 });

describe('isMigrationFileName', () => {
  it.each(['0001_initial_schema.sql', '0042_add_index2.sql'])('accepts %s', (name) => {
    expect(isMigrationFileName(name)).toBe(true);
  });

  it.each(['1_initial.sql', '0001-initial.sql', '0001_Initial.sql', '0001_.sql', '0001_x.SQL'])(
    'rejects %s',
    (name) => {
      expect(isMigrationFileName(name)).toBe(false);
    },
  );
});

describe('planMigrations', () => {
  it('has nothing to apply with zero migrations', () => {
    expect(planMigrations([], [])).toEqual({ pending: [], problems: [] });
  });

  it('plans every file in version order on an empty database', () => {
    const plan = planMigrations([file('0002_b.sql'), file('0001_a.sql')], []);

    expect(plan.problems).toEqual([]);
    expect(plan.pending.map(({ version, name }) => [version, name])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('applies nothing on a second run', () => {
    const files = [file('0001_a.sql'), file('0002_b.sql')];
    const applied = [
      { version: 1, name: 'a', sha256: 'sha-0001_a.sql' },
      { version: 2, name: 'b', sha256: 'sha-0002_b.sql' },
    ];

    expect(planMigrations(files, applied)).toEqual({ pending: [], problems: [] });
  });

  it('plans only the new file', () => {
    const plan = planMigrations(
      [file('0001_a.sql'), file('0002_b.sql')],
      [{ version: 1, name: 'a', sha256: 'sha-0001_a.sql' }],
    );

    expect(plan.pending.map(({ fileName }) => fileName)).toEqual(['0002_b.sql']);
  });

  it('refuses a changed file', () => {
    const plan = planMigrations(
      [file('0001_a.sql', 'edited')],
      [{ version: 1, name: 'a', sha256: 'original' }],
    );

    expect(plan).toEqual({ pending: [], problems: ['0001_a.sql: changed after it was applied'] });
  });

  it('refuses a missing applied file', () => {
    expect(planMigrations([], [{ version: 1, name: 'a', sha256: 'x' }]).problems).toEqual([
      '0001_a: applied but the file is missing',
    ]);
  });

  it('refuses a renamed applied file', () => {
    expect(
      planMigrations([file('0001_b.sql')], [{ version: 1, name: 'a', sha256: 'sha-0001_b.sql' }])
        .problems,
    ).toEqual(['0001_b.sql: version applied as 0001_a']);
  });

  it('refuses a pending file below the last applied version', () => {
    const plan = planMigrations(
      [file('0001_a.sql'), file('0003_c.sql')],
      [{ version: 3, name: 'c', sha256: 'sha-0003_c.sql' }],
    );

    expect(plan).toEqual({
      pending: [],
      problems: ['0001_a.sql: sorts below the last applied version 3'],
    });
  });

  it('refuses a duplicate version and an invalid name', () => {
    expect(
      planMigrations([file('0001_a.sql'), file('0001_b.sql'), file('init.sql')], []).problems,
    ).toEqual([
      '0001_b.sql: version already used by 0001_a.sql',
      'init.sql: invalid name, expected NNNN_snake_case_description.sql',
    ]);
  });
});

describe('hasNoTransactionMarker', () => {
  it.each([
    '-- kd:no-transaction\nCREATE INDEX CONCURRENTLY x ON t (c);',
    '\uFEFF-- kd:no-transaction\r\nSELECT 1;',
  ])('detects the marker on the first line', (sql) => {
    expect(hasNoTransactionMarker(sql)).toBe(true);
  });

  it.each(['CREATE TABLE t ();', 'SELECT 1;\n-- kd:no-transaction', ''])(
    'is false otherwise',
    (sql) => {
      expect(hasNoTransactionMarker(sql)).toBe(false);
    },
  );
});
