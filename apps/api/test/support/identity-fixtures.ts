import { inject } from 'vitest';

import { withConnection } from './test-database.js';

export interface IdentityFixtureIds {
  readonly userIds?: readonly string[];
  readonly branchIds?: readonly string[];
}

// Placeholder rows, fictional values only. Codes FA, FB, ... and slugs follow the position of the
// id in the list, so the unique columns never collide within one call.
const INSERT_USERS_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
SELECT id, 'fixture-user-' || n || '@kd.example', 'Người dùng mẫu', 'vi', 'CUSTOMER', 'ACTIVE'
  FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`;

/**
 * The province the placeholder branches sit in: `branches.province_code` references `provinces`
 * since migration 0009 (A2-T3). Fictional names; written as `kd_migrator`, because `kd_app` only
 * reads `provinces`. A no-op when the row is there.
 */
export const INSERT_FIXTURE_PROVINCE_SQL = `INSERT INTO public.provinces (code, names, type)
VALUES ('79', '{"vi": "Mẫu", "vi_full": "Thành phố Mẫu"}', 'CITY')
ON CONFLICT (code) DO NOTHING`;

const INSERT_BRANCHES_SQL = `INSERT INTO public.branches
  (id, code, slug, name, address_line, province_code, location, phone, status, accepts_pickup,
   accepts_delivery, accepts_reservations, default_prep_minutes, order_cutoff_minutes,
   reservation_slot_step_minutes, reservation_max_party, reservation_lead_minutes,
   reservation_max_days_ahead, sort_order)
SELECT id, 'F' || chr(64 + n::integer), 'fixture-branch-' || n, 'Chi nhánh mẫu', '1 Đường Mẫu', '79',
       ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326)::geography, '+84000000001', 'ACTIVE', true,
       false, false, 15, 30, 15, 8, 60, 30, n::integer
  FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`;

/**
 * Inserts placeholder `users` and `branches` rows with the given ids, as `kd_migrator`, so that a
 * spec of a table referencing them (`outbox_events`, `audit_logs`, `idempotency_keys`: foreign keys
 * of migration 0007) can write its rows. Call it after `truncateAll()`. At most 26 branches.
 */
export async function insertIdentityFixtures(ids: IdentityFixtureIds): Promise<void> {
  const userIds = ids.userIds ?? [];
  const branchIds = ids.branchIds ?? [];
  if (branchIds.length > 26) {
    throw new Error('insertIdentityFixtures: at most 26 branches (codes FA to FZ)');
  }
  const { migratorUrl } = inject('kdTestDatabase');
  await withConnection(migratorUrl, async (dataSource) => {
    if (userIds.length > 0) {
      await dataSource.query(INSERT_USERS_SQL, [userIds]);
    }
    if (branchIds.length > 0) {
      await dataSource.query(INSERT_FIXTURE_PROVINCE_SQL);
      await dataSource.query(INSERT_BRANCHES_SQL, [branchIds]);
    }
  });
}
