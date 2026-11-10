import { IntegrityError } from './step.js';
import type { SeedStep, SqlClient, TableCounts } from './step.js';

// The `vocabulary` step of `seed reference` (migration-plan, `seed reference` row: "amenities,
// tags"; data-model `amenities` and `tags`; api migrations 0013 and 0015). Planned by A4-T5 and
// written by A6-T5 once both tables existed. Each row is inserted only when its `code` (amenities)
// or `slug` (tags) has no row: `ON CONFLICT DO NOTHING`, so an edit made in the admin is never
// overwritten and a re-run changes nothing. `row_version`, timestamps and `updated_by` come from
// the tables.

/** `tools/seed/data/vocabulary.json`, from `dist/steps/` or `src/steps/`. */
export const VOCABULARY_FILE = new URL('../../data/vocabulary.json', import.meta.url);

/**
 * The amenity icon keys. A mirror of `apps/api/src/modules/branches/amenity-icons.ts` (this
 * package may not import `@kd/api`, decision 0003 section 6), as the settings rules are (D-122).
 */
export const AMENITY_ICONS = Object.freeze([
  'wifi',
  'car',
  'snow',
  'tree',
  'door',
  'child',
  'wheelchair',
  'box',
] as const);

/** `public.tag_kind` (api migration 0015). */
export const TAG_KINDS = Object.freeze(['DIETARY', 'ALLERGEN', 'LABEL'] as const);

/** The slug shape of the API (`common/text/slugify.ts`): lower-case words joined by hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** The API's bound on a code or slug and on one translated name (api-divergences D-158). */
const KEY_MAX_LENGTH = 60;
const NAME_MAX_LENGTH = 60;
const NAME_LOCALES: readonly string[] = ['vi', 'en'];

export interface VocabularyNames {
  readonly vi: string;
  readonly en?: string;
}

export interface AmenityRow {
  readonly code: string;
  readonly names: VocabularyNames;
  readonly icon: string;
}

export interface TagRow {
  readonly kind: string;
  readonly slug: string;
  readonly names: VocabularyNames;
}

export interface Vocabulary {
  readonly amenities: readonly AmenityRow[];
  readonly tags: readonly TagRow[];
}

const FILE = 'vocabulary.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    [...value].length <= NAME_MAX_LENGTH
  );
}

function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= KEY_MAX_LENGTH && SLUG_PATTERN.test(value);
}

function parseNames(value: unknown, where: string): VocabularyNames {
  if (!isRecord(value)) {
    throw new IntegrityError(`${FILE}: ${where} names must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !NAME_LOCALES.includes(key));
  if (unknown.length > 0) {
    throw new IntegrityError(`${FILE}: ${where} names has an unknown locale ${unknown.join(', ')}`);
  }
  const { vi, en } = value;
  if (!isName(vi)) {
    throw new IntegrityError(
      `${FILE}: ${where} names.vi must be 1 to ${NAME_MAX_LENGTH} characters`,
    );
  }
  if (en !== undefined && !isName(en)) {
    throw new IntegrityError(
      `${FILE}: ${where} names.en must be 1 to ${NAME_MAX_LENGTH} characters`,
    );
  }
  return en === undefined ? { vi } : { vi, en };
}

function rowsOf(json: Record<string, unknown>, member: string): Record<string, unknown>[] {
  const rows = json[member];
  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    throw new IntegrityError(`${FILE}: ${member} must be an array of objects`);
  }
  return rows;
}

function assertUnique(keys: readonly string[], member: string, key: string): void {
  const seen = new Set<string>();
  for (const value of keys) {
    if (seen.has(value)) {
      throw new IntegrityError(`${FILE}: ${member} has the ${key} ${value} twice`);
    }
    seen.add(value);
  }
}

/**
 * Maps and checks the vocabulary file before any statement: codes and slugs in the slug shape and
 * unique, known icons and kinds, a `vi` name on every row, `en` optional. Throws `IntegrityError`
 * (exit 4) naming the row by its code or slug, never by a name.
 */
export function parseVocabulary(json: unknown): Vocabulary {
  if (!isRecord(json)) {
    throw new IntegrityError(`${FILE}: expected an object with amenities and tags`);
  }
  const amenities = rowsOf(json, 'amenities').map((row, index): AmenityRow => {
    const { code, icon } = row;
    if (!isKey(code)) {
      throw new IntegrityError(`${FILE}: amenities[${index}] code must be a slug`);
    }
    if (typeof icon !== 'string' || !(AMENITY_ICONS as readonly string[]).includes(icon)) {
      throw new IntegrityError(`${FILE}: amenity ${code} has an unknown icon`);
    }
    return { code, names: parseNames(row['names'], `amenity ${code}`), icon };
  });
  const tags = rowsOf(json, 'tags').map((row, index): TagRow => {
    const { kind, slug } = row;
    if (!isKey(slug)) {
      throw new IntegrityError(`${FILE}: tags[${index}] slug must be a slug`);
    }
    if (typeof kind !== 'string' || !(TAG_KINDS as readonly string[]).includes(kind)) {
      throw new IntegrityError(`${FILE}: tag ${slug} has an unknown kind`);
    }
    return { kind, slug, names: parseNames(row['names'], `tag ${slug}`) };
  });
  assertUnique(
    amenities.map((row) => row.code),
    'amenities',
    'code',
  );
  assertUnique(
    tags.map((row) => row.slug),
    'tags',
    'slug',
  );
  return { amenities, tags };
}

export const SELECT_AMENITY_CODES_SQL = 'SELECT code FROM public.amenities WHERE code = ANY($1)';
export const SELECT_TAG_SLUGS_SQL = 'SELECT slug FROM public.tags WHERE slug = ANY($1)';

/** Inserts the absent codes only. */
export const INSERT_AMENITIES_SQL = `INSERT INTO public.amenities (code, names, icon)
SELECT code, names, icon FROM unnest($1::text[], $2::jsonb[], $3::text[]) AS t(code, names, icon)
ON CONFLICT (code) DO NOTHING
RETURNING code`;

/** Inserts the absent slugs only. */
export const INSERT_TAGS_SQL = `INSERT INTO public.tags (kind, slug, names)
SELECT kind::public.tag_kind, slug, names
  FROM unnest($1::text[], $2::text[], $3::jsonb[]) AS t(kind, slug, names)
ON CONFLICT (slug) DO NOTHING
RETURNING slug`;

/**
 * Counts of one table: an absent key is inserted, a present one is unchanged whatever its content.
 * Rows of the table that the file does not name are the admin's own and are not reported as stale.
 */
export function planInsertIfMissing(
  table: string,
  keys: readonly string[],
  storedKeys: ReadonlySet<string>,
): TableCounts {
  const present = keys.filter((key) => storedKeys.has(key)).length;
  return {
    table,
    inserted: keys.length - present,
    updated: 0,
    unchanged: present,
    stale: 0,
    staleSample: [],
  };
}

/** The step. `load` returns the parsed JSON of the vocabulary file; it is called once. */
export function createVocabularyStep(load: () => Promise<unknown>): SeedStep {
  let vocabulary: Promise<Vocabulary> | undefined;
  const source = () => {
    vocabulary ??= load().then(parseVocabulary);
    return vocabulary;
  };

  return {
    name: 'vocabulary',

    async plan(client: SqlClient): Promise<readonly TableCounts[]> {
      const { amenities, tags } = await source();
      const codes = amenities.map((row) => row.code);
      const slugs = tags.map((row) => row.slug);
      const storedCodes = await client.query<{ code: string }>(SELECT_AMENITY_CODES_SQL, [codes]);
      const storedSlugs = await client.query<{ slug: string }>(SELECT_TAG_SLUGS_SQL, [slugs]);
      return [
        planInsertIfMissing('amenities', codes, new Set(storedCodes.rows.map((row) => row.code))),
        planInsertIfMissing('tags', slugs, new Set(storedSlugs.rows.map((row) => row.slug))),
      ];
    },

    async apply(client: SqlClient): Promise<ReadonlyMap<string, number>> {
      const { amenities, tags } = await source();
      const insertedAmenities = await client.query(INSERT_AMENITIES_SQL, [
        amenities.map((row) => row.code),
        amenities.map((row) => JSON.stringify(row.names)),
        amenities.map((row) => row.icon),
      ]);
      const insertedTags = await client.query(INSERT_TAGS_SQL, [
        tags.map((row) => row.kind),
        tags.map((row) => row.slug),
        tags.map((row) => JSON.stringify(row.names)),
      ]);
      return new Map([
        ['amenities', insertedAmenities.rows.length],
        ['tags', insertedTags.rows.length],
      ]);
    },
  };
}
