import { DataSource } from 'typeorm';

import type { Environment } from '../../src/config/load-config.js';
import { describeDatabaseTarget } from '../../src/database/data-source.js';

/**
 * The two URLs of the test database, derived from the dev URLs of the root `.env`. Handed from the
 * global setup to the workers with `provide`/`inject`; never logged or printed.
 */
export interface TestDatabaseUrls {
  /** As `kd_migrator`: migrations, reset, truncate. */
  readonly migratorUrl: string;
  /** As `kd_app`: the server under test and the privilege specs. */
  readonly appUrl: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    kdTestDatabase: TestDatabaseUrls;
  }
}

/** The repository root `.env` (decision 0005, section 3), from `apps/api/test/support/`. */
export const ROOT_ENV_FILE = new URL('../../../../.env', import.meta.url);

/**
 * An existing, empty database owned by `kd_migrator` with the extensions present (Docker decision
 * 0004 section 2). `kd_migrator` is `NOCREATEDB`, so the suite never creates one.
 */
export const DEFAULT_TEST_DATABASE_NAME = 'kd_scratch';

const ALLOWED_APP_ENVS: readonly string[] = ['dev', 'test'];
const TEST_DATABASE_NAME_FORMAT = /^kd_[a-z0-9_]+$/;
const MIGRATOR_ROLE = 'kd_migrator';

/** The suite refuses its target. The message names the rule, never a value. */
export class TestDatabaseRefusal extends Error {
  constructor(rule: string) {
    super(`integration tests refused: ${rule}`);
    this.name = 'TestDatabaseRefusal';
  }
}

function read(env: Environment, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function requireDatabaseUrl(env: Environment, name: string): string {
  const value = read(env, name);
  if (value === undefined || !URL.canParse(value)) {
    throw new TestDatabaseRefusal(`${name} must be set to a PostgreSQL URL (run pnpm env:sync)`);
  }
  const { protocol, hostname } = new URL(value);
  if ((protocol !== 'postgres:' && protocol !== 'postgresql:') || hostname === '') {
    throw new TestDatabaseRefusal(`${name} must be a postgres:// URL with a host`);
  }
  return value;
}

function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/**
 * Derives the test database URLs from `DATABASE_URL_MIGRATOR` and `DATABASE_URL_APP` by replacing
 * the database name with `TEST_DATABASE_NAME` (default `kd_scratch`). Refuses unless `APP_ENV` is
 * `dev` or `test`, the name starts with `kd_` and contains `scratch` or `test`, and it differs from
 * the database of both dev URLs. Pure: reads only `env`.
 */
export function resolveTestDatabase(env: Environment): TestDatabaseUrls {
  const appEnv = read(env, 'APP_ENV');
  if (appEnv === undefined || !ALLOWED_APP_ENVS.includes(appEnv)) {
    throw new TestDatabaseRefusal('APP_ENV must be dev or test');
  }
  if (read(env, 'DATABASE_URL') !== undefined) {
    throw new TestDatabaseRefusal(
      'DATABASE_URL must be unset on the host (decision 0005 section 2)',
    );
  }
  const migratorUrl = requireDatabaseUrl(env, 'DATABASE_URL_MIGRATOR');
  const appUrl = requireDatabaseUrl(env, 'DATABASE_URL_APP');

  const name = read(env, 'TEST_DATABASE_NAME') ?? DEFAULT_TEST_DATABASE_NAME;
  if (
    !TEST_DATABASE_NAME_FORMAT.test(name) ||
    !(name.includes('scratch') || name.includes('test'))
  ) {
    throw new TestDatabaseRefusal(
      'TEST_DATABASE_NAME must start with kd_, use only a-z, 0-9 and _, and contain scratch or test',
    );
  }
  if (name === databaseNameOf(migratorUrl) || name === databaseNameOf(appUrl)) {
    throw new TestDatabaseRefusal(
      'TEST_DATABASE_NAME must differ from the database of DATABASE_URL_MIGRATOR and DATABASE_URL_APP',
    );
  }

  return {
    migratorUrl: withDatabase(migratorUrl, name),
    appUrl: withDatabase(appUrl, name),
  };
}

/** `host:port/database` of the test database, for messages. */
export function describeTestDatabase(urls: TestDatabaseUrls): string {
  return describeDatabaseTarget(urls.migratorUrl);
}

/**
 * Opens a TypeORM `DataSource` with no entity (TypeORM's `postgres` driver is `pg`), runs `work`
 * and closes it. A connection failure is rethrown with `host:port/database` and the driver code
 * only, never the URL.
 */
export async function withConnection<T>(
  url: string,
  work: (dataSource: DataSource) => Promise<T>,
): Promise<T> {
  const dataSource = new DataSource({ type: 'postgres', url, entities: [], logging: false });
  try {
    await dataSource.initialize();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    throw new Error(
      `cannot connect to ${describeDatabaseTarget(url)}${typeof code === 'string' ? ` (${code})` : ''}; is the stack up (pnpm dev:infra)?`,
      // The pg driver's connection errors carry host, port and role, never the URL or password.
      { cause: error },
    );
  }
  try {
    return await work(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

/**
 * Drops every table, view, sequence, routine and type of schema `public` that belongs to no
 * extension (`pg_depend.deptype = 'e'` excludes the members of postgis, pg_trgm, unaccent and
 * citext), `schema_migrations` included. Never `DROP SCHEMA` and never `DROP OWNED`: those would
 * remove the extensions or the default privileges of the Docker baseline. `IF EXISTS` because a
 * `CASCADE` may already have dropped a later object.
 */
export const RESET_SQL = `DO $reset$
DECLARE
  statement text;
BEGIN
  FOR statement IN
    SELECT ddl FROM (
      SELECT 1 AS rank, c.relname::text AS name,
             format(
               CASE c.relkind
                 WHEN 'v' THEN 'DROP VIEW IF EXISTS public.%I CASCADE'
                 WHEN 'm' THEN 'DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE'
                 WHEN 'S' THEN 'DROP SEQUENCE IF EXISTS public.%I CASCADE'
                 ELSE 'DROP TABLE IF EXISTS public.%I CASCADE'
               END,
               c.relname) AS ddl
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
         AND NOT EXISTS (
               SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      UNION ALL
      SELECT 2, p.proname::text,
             format('DROP ROUTINE IF EXISTS public.%I(%s) CASCADE',
                    p.proname, pg_get_function_identity_arguments(p.oid))
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND NOT EXISTS (
               SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      UNION ALL
      SELECT 3, t.typname::text,
             format(
               CASE t.typtype WHEN 'd' THEN 'DROP DOMAIN IF EXISTS public.%I CASCADE'
                              ELSE 'DROP TYPE IF EXISTS public.%I CASCADE' END,
               t.typname)
        FROM pg_type t
       WHERE t.typnamespace = 'public'::regnamespace
         AND t.typtype IN ('c', 'd', 'e', 'r')
         AND (t.typtype <> 'c'
              OR EXISTS (SELECT 1 FROM pg_class r WHERE r.oid = t.typrelid AND r.relkind = 'c'))
         AND NOT EXISTS (
               SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
    ) AS objects
    ORDER BY rank, name
  LOOP
    EXECUTE statement;
  END LOOP;
END
$reset$`;

/**
 * Empties the test database as `kd_migrator`, after checking that the connection really is
 * `kd_migrator` on the expected database.
 */
export async function resetTestDatabase(urls: TestDatabaseUrls): Promise<void> {
  await withConnection(urls.migratorUrl, async (dataSource) => {
    const rows: { current_user: string; current_database: string }[] = await dataSource.query(
      'SELECT current_user::text AS current_user, current_database()::text AS current_database',
    );
    const row = rows[0];
    if (row?.current_user !== MIGRATOR_ROLE) {
      throw new TestDatabaseRefusal(`the reset must run as ${MIGRATOR_ROLE}`);
    }
    if (row.current_database !== databaseNameOf(urls.migratorUrl)) {
      throw new TestDatabaseRefusal('the connection is not on TEST_DATABASE_NAME');
    }
    await dataSource.query(RESET_SQL);
  });
}
