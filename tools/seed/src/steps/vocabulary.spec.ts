import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runSteps, SEED_LOCK_SQL } from '../runner.js';
import { IntegrityError } from './step.js';
import type { SqlClient } from './step.js';
import {
  AMENITY_ICONS,
  createVocabularyStep,
  INSERT_AMENITIES_SQL,
  INSERT_TAGS_SQL,
  parseVocabulary,
  planInsertIfMissing,
  SELECT_AMENITY_CODES_SQL,
  SELECT_TAG_SLUGS_SQL,
  VOCABULARY_FILE,
} from './vocabulary.js';

const FILE_JSON = JSON.parse(readFileSync(VOCABULARY_FILE, 'utf8')) as {
  amenities: Record<string, unknown>[];
  tags: Record<string, unknown>[];
};

const CODES = FILE_JSON.amenities.map((row) => String(row['code']));
const SLUGS = FILE_JSON.tags.map((row) => String(row['slug']));

/**
 * A client backed by two in-memory key sets, as the tables would be: the SELECTs answer the stored
 * keys and the INSERTs add the absent ones (`ON CONFLICT DO NOTHING`). `BEGIN`, the lock,
 * `COMMIT` and `ROLLBACK` are recorded only; a rolled-back run restores the sets.
 */
function tableClient(stored: { codes?: readonly string[]; slugs?: readonly string[] } = {}) {
  const codes = new Set(stored.codes ?? []);
  const slugs = new Set(stored.slugs ?? []);
  let snapshot: { codes: Set<string>; slugs: Set<string> } | undefined;
  const statements: string[] = [];

  const insertAbsent = (keys: readonly string[], into: Set<string>): string[] => {
    const inserted = keys.filter((key) => !into.has(key));
    for (const key of inserted) {
      into.add(key);
    }
    return inserted;
  };

  const client: SqlClient = {
    query: async <Row>(text: string, values?: readonly unknown[]) => {
      statements.push(text);
      if (text === 'BEGIN') {
        snapshot = { codes: new Set(codes), slugs: new Set(slugs) };
      } else if (text === 'ROLLBACK' && snapshot !== undefined) {
        codes.clear();
        snapshot.codes.forEach((key) => codes.add(key));
        slugs.clear();
        snapshot.slugs.forEach((key) => slugs.add(key));
      } else if (text === SELECT_AMENITY_CODES_SQL) {
        const asked = (values?.[0] ?? []) as string[];
        return { rows: asked.filter((key) => codes.has(key)).map((code) => ({ code })) as Row[] };
      } else if (text === SELECT_TAG_SLUGS_SQL) {
        const asked = (values?.[0] ?? []) as string[];
        return { rows: asked.filter((key) => slugs.has(key)).map((slug) => ({ slug })) as Row[] };
      } else if (text === INSERT_AMENITIES_SQL) {
        const inserted = insertAbsent((values?.[0] ?? []) as string[], codes);
        return { rows: inserted.map((code) => ({ code })) as Row[] };
      } else if (text === INSERT_TAGS_SQL) {
        const inserted = insertAbsent((values?.[1] ?? []) as string[], slugs);
        return { rows: inserted.map((slug) => ({ slug })) as Row[] };
      }
      return { rows: [] as Row[] };
    },
  };
  return { client, statements, codes, slugs };
}

describe('parseVocabulary', () => {
  it('reads the committed file: seven amenities and twelve tags with vi names', () => {
    const { amenities, tags } = parseVocabulary(FILE_JSON);

    expect(amenities.map((row) => row.code)).toEqual([
      'wifi',
      'parking',
      'air-conditioning',
      'outdoor-seating',
      'private-room',
      'kid-friendly',
      'wheelchair-access',
    ]);
    expect(amenities.every((row) => (AMENITY_ICONS as readonly string[]).includes(row.icon))).toBe(
      true,
    );
    expect(tags).toHaveLength(12);
    expect(tags.filter((row) => row.kind === 'DIETARY')).toHaveLength(3);
    expect(tags.filter((row) => row.kind === 'ALLERGEN')).toHaveLength(6);
    expect(tags.filter((row) => row.kind === 'LABEL')).toHaveLength(3);
    expect([...amenities, ...tags].every((row) => row.names.vi.length > 0)).toBe(true);
  });

  const amenity = { code: 'wifi', names: { vi: 'Wifi' }, icon: 'wifi' };
  const tag = { kind: 'LABEL', slug: 'cay', names: { vi: 'Cay' } };

  it.each([
    ['not an object', [], 'expected an object'],
    ['no tags array', { amenities: [] }, 'tags must be an array'],
    [
      'a code that is not a slug',
      { amenities: [{ ...amenity, code: 'Wi Fi' }], tags: [] },
      'code must be a slug',
    ],
    ['an unknown icon', { amenities: [{ ...amenity, icon: 'pool' }], tags: [] }, 'unknown icon'],
    ['an unknown kind', { amenities: [], tags: [{ ...tag, kind: 'OTHER' }] }, 'unknown kind'],
    [
      'a missing vi name',
      { amenities: [], tags: [{ ...tag, names: { en: 'Spicy' } }] },
      'names.vi',
    ],
    ['a blank vi name', { amenities: [], tags: [{ ...tag, names: { vi: ' ' } }] }, 'names.vi'],
    [
      'an unknown locale',
      { amenities: [], tags: [{ ...tag, names: { vi: 'Cay', fr: 'Épicé' } }] },
      'unknown locale fr',
    ],
    ['a duplicate slug', { amenities: [], tags: [tag, tag] }, 'slug cay twice'],
    ['a duplicate code', { amenities: [amenity, amenity], tags: [] }, 'code wifi twice'],
  ])('refuses %s with an IntegrityError', (_case, json, message) => {
    expect(() => parseVocabulary(json)).toThrow(IntegrityError);
    expect(() => parseVocabulary(json)).toThrow(message);
  });
});

describe('planInsertIfMissing', () => {
  it('inserts the absent keys and never plans an update or a stale row', () => {
    expect(planInsertIfMissing('tags', ['a', 'b', 'c'], new Set(['b', 'admin-own']))).toEqual({
      table: 'tags',
      inserted: 2,
      updated: 0,
      unchanged: 1,
      stale: 0,
      staleSample: [],
    });
  });
});

describe('createVocabularyStep', () => {
  const step = () => createVocabularyStep(async () => FILE_JSON);

  it('plans with one SELECT per table and inserts with ON CONFLICT DO NOTHING', async () => {
    const { client, statements } = tableClient({ codes: ['wifi'], slugs: ['cay'] });
    const seeded = step();

    const planned = await seeded.plan(client);
    const applied = await seeded.apply(client);

    expect(planned).toEqual([
      expect.objectContaining({ table: 'amenities', inserted: 6, updated: 0, unchanged: 1 }),
      expect.objectContaining({ table: 'tags', inserted: 11, updated: 0, unchanged: 1 }),
    ]);
    expect(applied).toEqual(
      new Map([
        ['amenities', 6],
        ['tags', 11],
      ]),
    );
    expect(statements).toEqual([
      SELECT_AMENITY_CODES_SQL,
      SELECT_TAG_SLUGS_SQL,
      INSERT_AMENITIES_SQL,
      INSERT_TAGS_SQL,
    ]);
  });

  it('never overwrites: the SQL has no UPDATE and does nothing on conflict', () => {
    expect(INSERT_AMENITIES_SQL).toContain('ON CONFLICT (code) DO NOTHING');
    expect(INSERT_TAGS_SQL).toContain('ON CONFLICT (slug) DO NOTHING');
    expect(`${INSERT_AMENITIES_SQL}${INSERT_TAGS_SQL}`).not.toMatch(/\bUPDATE\b/u);
  });

  it('dry run: prints one line per table and writes nothing', async () => {
    const tables = tableClient();
    const lines: string[] = [];

    const result = await runSteps(tables.client, [step()], {
      commit: false,
      report: (line) => lines.push(line),
    });

    expect(result.committed).toBe(false);
    expect(lines).toEqual([
      'vocabulary  amenities  inserted 7  updated 0  unchanged 0  stale 0',
      'vocabulary  tags  inserted 12  updated 0  unchanged 0  stale 0',
    ]);
    expect(tables.statements[0]).toBe('BEGIN');
    expect(tables.statements[1]).toBe(SEED_LOCK_SQL);
    expect(tables.statements.at(-1)).toBe('ROLLBACK');
    expect(tables.statements).not.toContain('COMMIT');
    expect(tables.codes.size).toBe(0);
    expect(tables.slugs.size).toBe(0);
  });

  it('commit then a second run: the second run changes nothing', async () => {
    const tables = tableClient();
    const lines: string[] = [];
    const report = (line: string) => lines.push(line);

    await runSteps(tables.client, [step()], { commit: true, report });
    lines.length = 0;
    await runSteps(tables.client, [step()], { commit: true, report });

    expect(tables.codes).toEqual(new Set(CODES));
    expect(tables.slugs).toEqual(new Set(SLUGS));
    expect(lines).toEqual([
      'vocabulary  amenities  inserted 0  updated 0  unchanged 7  stale 0',
      'vocabulary  tags  inserted 0  updated 0  unchanged 12  stale 0',
    ]);
  });
});
