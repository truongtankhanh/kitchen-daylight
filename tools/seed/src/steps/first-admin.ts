import { emailDomain } from '../environment.js';
import type { FirstAdmin } from '../environment.js';
import type { SeedStep, SqlClient, TableCounts } from './step.js';

// The `first-admin` step of `seed reference` (migration-plan, `seed reference` row; ADR-0009 WA4,
// WA20; api migration `0007_users_branches_staff.sql`). One `ADMIN`, status `INVITED`, no password
// and no MFA credential, only when no user has that email; an existing user is never touched. The
// person asks for a link at `POST /admin/auth/password/forgot` (an `INVITED` account receives a
// fresh invitation, api-divergences D-084), sets a password, and enrols TOTP at the first sign-in.

/** The locale of a new account (api-outline Conventions "Locale": `vi`). */
export const ADMIN_LOCALE = 'vi';

/** `users.email` is `citext`: the comparison ignores case. */
export const SELECT_USER_BY_EMAIL_SQL = 'SELECT 1 AS present FROM public.users WHERE email = $1';

/**
 * `ON CONFLICT (email) DO NOTHING`: an existing user, whatever its role or status, is left as it
 * is. No `UPDATE` of `users` anywhere in this step.
 */
export const INSERT_ADMIN_SQL = `INSERT INTO public.users (email, display_name, locale, role, status)
VALUES ($1, $2, $3, 'ADMIN', 'INVITED')
ON CONFLICT (email) DO NOTHING
RETURNING id`;

/** Counts and the report note: the email domain only, never the address or the name. */
export function planFirstAdmin(admin: FirstAdmin | null, exists: boolean): TableCounts {
  const base = { table: 'users', updated: 0, stale: 0, staleSample: [] };
  if (admin === null) {
    return { ...base, inserted: 0, unchanged: 0, note: 'SEED_ADMIN_EMAIL unset, skipped' };
  }
  const domain = emailDomain(admin.email);
  return exists
    ? { ...base, inserted: 0, unchanged: 1, note: `a user @${domain} exists, left as it is` }
    : { ...base, inserted: 1, unchanged: 0, note: `ADMIN invited @${domain}` };
}

/** The step. `admin` is `readFirstAdmin` of the environment; `null` skips it. */
export function createFirstAdminStep(admin: FirstAdmin | null): SeedStep {
  return {
    name: 'first-admin',

    async plan(client: SqlClient): Promise<readonly TableCounts[]> {
      if (admin === null) {
        return [planFirstAdmin(null, false)];
      }
      const result = await client.query(SELECT_USER_BY_EMAIL_SQL, [admin.email]);
      return [planFirstAdmin(admin, result.rows.length > 0)];
    },

    async apply(client: SqlClient): Promise<ReadonlyMap<string, number>> {
      if (admin === null) {
        return new Map([['users', 0]]);
      }
      const result = await client.query(INSERT_ADMIN_SQL, [admin.email, admin.name, ADMIN_LOCALE]);
      return new Map([['users', result.rows.length]]);
    },
  };
}
