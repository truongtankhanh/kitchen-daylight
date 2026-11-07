import type { UserStatus } from './entities/user.entity.js';

/**
 * Allowed moves of `users.status` (proposal; the data model lists the statuses but no transitions,
 * api-divergences D-038):
 * - `INVITED` → `ACTIVE` (invitation accepted) or `SUSPENDED` (invitation withdrawn);
 * - `ACTIVE` ↔ `SUSPENDED` (disable and re-enable, brief E8);
 * - `SUSPENDED` → `INVITED`: re-enabling a staff account that never set a password (a withdrawn
 *   invitation) reinstates the invitation instead of an `ACTIVE` account without a password
 *   (A3-T4; api-divergences D-096). `users_invited_is_staff` keeps customers out of it;
 * - `ACTIVE` or `SUSPENDED` → `DELETED` (anonymised tombstone);
 * - `DELETED` is final. Staying in the same status is not a move.
 */
export const USER_STATUS_TRANSITIONS: Readonly<Record<UserStatus, readonly UserStatus[]>> = {
  INVITED: ['ACTIVE', 'SUSPENDED'],
  ACTIVE: ['SUSPENDED', 'DELETED'],
  SUSPENDED: ['ACTIVE', 'DELETED', 'INVITED'],
  DELETED: [],
};

export function canTransition(from: UserStatus, to: UserStatus): boolean {
  return USER_STATUS_TRANSITIONS[from].includes(to);
}

/** Moves after which the user's sessions must end (decision 0008 section 1). */
export function endsSessions(to: UserStatus): boolean {
  return to === 'SUSPENDED' || to === 'DELETED';
}
