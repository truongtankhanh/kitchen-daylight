// Preflight of `migrate` (decision 0005, section 7), against the baseline that the database
// provisioning creates (Docker repository, decision 0004, section 4).

export const MIGRATOR_ROLE = 'kd_migrator';
export const REQUIRED_MAJOR_VERSION = 18;
export const REQUIRED_EXTENSIONS = ['postgis', 'pg_trgm', 'unaccent', 'citext'] as const;

/** One row; `$1` is `REQUIRED_EXTENSIONS`. */
export const PREFLIGHT_QUERY = `
SELECT current_user::text AS current_user,
       current_setting('server_version_num')::int AS server_version_num,
       to_regprocedure('uuidv7()') IS NOT NULL AS has_uuidv7,
       COALESCE(
         (SELECT array_agg(e.extname::text ORDER BY e.extname)
            FROM pg_extension e
            JOIN pg_namespace n ON n.oid = e.extnamespace
           WHERE n.nspname = 'public' AND e.extname = ANY($1::text[])),
         '{}'
       ) AS extensions_in_public`;

export interface PreflightFacts {
  readonly currentUser: string;
  readonly serverVersionNum: number;
  readonly hasUuidv7: boolean;
  readonly extensionsInPublic: readonly string[];
}

/** Maps the row of `PREFLIGHT_QUERY`; throws when the row does not have the expected shape. */
export function toPreflightFacts(row: unknown): PreflightFacts {
  const value = (row ?? {}) as Record<string, unknown>;
  const { current_user, server_version_num, has_uuidv7, extensions_in_public } = value;
  if (
    typeof current_user !== 'string' ||
    typeof server_version_num !== 'number' ||
    typeof has_uuidv7 !== 'boolean' ||
    !Array.isArray(extensions_in_public)
  ) {
    throw new Error('unexpected preflight result');
  }
  return {
    currentUser: current_user,
    serverVersionNum: server_version_num,
    hasUuidv7: has_uuidv7,
    extensionsInPublic: extensions_in_public.map(String),
  };
}

/** One line per failed check; empty when every check passes. */
export function evaluatePreflight(facts: PreflightFacts): string[] {
  const failures: string[] = [];

  if (facts.currentUser !== MIGRATOR_ROLE) {
    failures.push(`current_user is ${facts.currentUser}, expected ${MIGRATOR_ROLE}`);
  }

  const major = Math.floor(facts.serverVersionNum / 10_000);
  if (major !== REQUIRED_MAJOR_VERSION) {
    failures.push(`PostgreSQL major version is ${major}, expected ${REQUIRED_MAJOR_VERSION}`);
  }

  for (const extension of REQUIRED_EXTENSIONS) {
    if (!facts.extensionsInPublic.includes(extension)) {
      failures.push(`extension ${extension} is not installed in schema public`);
    }
  }

  if (!facts.hasUuidv7) {
    failures.push('function uuidv7() is not available');
  }

  return failures;
}
