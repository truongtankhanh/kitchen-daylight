import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SETTING_SCHEMAS } from './schema/registry.js';
import { SETTING_KEYS } from './schema/setting-rules.js';
import { SETTING_DEFAULTS } from './settings-defaults.js';

// Drift check of the seed's copy of the defaults (api-divergences D-122). `@kd/seed` may not import
// `@kd/api` (decision 0003 section 6), so `seed reference` reads its own JSON copy. This spec reads
// that file as data (no import, no runtime dependency) and fails CI when the two copies differ or
// the copy breaks a rule of the API. Change both in the same commit.

const SEED_DEFAULTS_FILE = new URL(
  '../../../../../tools/seed/data/app-settings.defaults.json',
  import.meta.url,
);

const seedRows = (
  JSON.parse(readFileSync(SEED_DEFAULTS_FILE, 'utf8')) as { rows: Record<string, unknown> }
).rows;

describe("the seed's copy of SETTING_DEFAULTS (tools/seed/data/app-settings.defaults.json)", () => {
  it('holds exactly the eight storage keys', () => {
    expect(Object.keys(seedRows).sort()).toEqual(
      SETTING_KEYS.map((key) => SETTING_SCHEMAS[key].storageKey).sort(),
    );
  });

  it.each(SETTING_KEYS)('%s: equals the API default in its stored form', (key) => {
    const schema = SETTING_SCHEMAS[key];
    // Each schema maps its own key's value; the union of the eight signatures is not callable.
    const toStored = schema.toStored as (value: unknown) => unknown;

    expect(seedRows[schema.storageKey]).toEqual(toStored(SETTING_DEFAULTS[key]));
  });

  it.each(SETTING_KEYS)('%s: passes the API rules once read back', (key) => {
    const schema = SETTING_SCHEMAS[key];
    const fromStored = schema.fromStored as (stored: unknown) => unknown;

    const result = schema.parse(fromStored(seedRows[schema.storageKey]));

    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});
