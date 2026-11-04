import { describe, expect, it } from 'vitest';

import { evaluatePreflight, toPreflightFacts } from './preflight.js';
import type { PreflightFacts } from './preflight.js';

const HEALTHY: PreflightFacts = {
  currentUser: 'kd_migrator',
  serverVersionNum: 180_001,
  hasUuidv7: true,
  extensionsInPublic: ['citext', 'pg_trgm', 'postgis', 'unaccent'],
};

describe('evaluatePreflight', () => {
  it('passes on the provisioned baseline', () => {
    expect(evaluatePreflight(HEALTHY)).toEqual([]);
  });

  it('refuses another role', () => {
    expect(evaluatePreflight({ ...HEALTHY, currentUser: 'kd_app' })).toEqual([
      'current_user is kd_app, expected kd_migrator',
    ]);
  });

  it.each([
    [170_005, 17],
    [190_000, 19],
  ])('refuses server_version_num %i', (serverVersionNum, major) => {
    expect(evaluatePreflight({ ...HEALTHY, serverVersionNum })).toEqual([
      `PostgreSQL major version is ${major}, expected 18`,
    ]);
  });

  it('accepts any 18.x minor', () => {
    expect(evaluatePreflight({ ...HEALTHY, serverVersionNum: 189_999 })).toEqual([]);
  });

  it('names each missing extension', () => {
    expect(evaluatePreflight({ ...HEALTHY, extensionsInPublic: ['citext', 'pg_trgm'] })).toEqual([
      'extension postgis is not installed in schema public',
      'extension unaccent is not installed in schema public',
    ]);
  });

  it('refuses a database without uuidv7()', () => {
    expect(evaluatePreflight({ ...HEALTHY, hasUuidv7: false })).toEqual([
      'function uuidv7() is not available',
    ]);
  });

  it('reports every failed check, one line each', () => {
    const failures = evaluatePreflight({
      currentUser: 'postgres',
      serverVersionNum: 170_000,
      hasUuidv7: false,
      extensionsInPublic: [],
    });

    expect(failures).toHaveLength(7);
  });
});

describe('toPreflightFacts', () => {
  it('maps the query row', () => {
    const row = {
      current_user: 'kd_migrator',
      server_version_num: 180_001,
      has_uuidv7: true,
      extensions_in_public: ['citext'],
    };

    expect(toPreflightFacts(row)).toEqual({
      currentUser: 'kd_migrator',
      serverVersionNum: 180_001,
      hasUuidv7: true,
      extensionsInPublic: ['citext'],
    });
  });

  it.each([undefined, {}, { current_user: 'kd_migrator', server_version_num: '180001' }])(
    'rejects an unexpected row %j',
    (row) => {
      expect(() => toPreflightFacts(row)).toThrow('unexpected preflight result');
    },
  );
});
