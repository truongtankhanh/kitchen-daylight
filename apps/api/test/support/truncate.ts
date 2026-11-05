import { inject } from 'vitest';

import { withConnection } from './test-database.js';

/**
 * Empties every table of schema `public` that belongs to no extension, except the runner's
 * `schema_migrations`, in one `TRUNCATE ... RESTART IDENTITY CASCADE`.
 */
export const TRUNCATE_ALL_SQL = `DO $truncate$
DECLARE
  tables text;
BEGIN
  SELECT string_agg(format('public.%I', c.relname), ', ' ORDER BY c.relname)
    INTO tables
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND c.relname <> 'schema_migrations'
     AND NOT EXISTS (
           SELECT 1 FROM pg_depend d
            WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');
  IF tables IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
  END IF;
END
$truncate$`;

/**
 * Empties the application tables as `kd_migrator` (`kd_app` has no `TRUNCATE`). Call it in the
 * `beforeEach` of a spec that needs empty tables; the migrations stay applied.
 */
export async function truncateAll(): Promise<void> {
  const { migratorUrl } = inject('kdTestDatabase');
  await withConnection(migratorUrl, async (dataSource) => {
    await dataSource.query(TRUNCATE_ALL_SQL);
  });
}
