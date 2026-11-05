import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@kd/contracts';
import type { AuditAction, AuditEntityType } from '@kd/contracts';

// The catalogue itself lives in @kd/contracts (decision 0007 contradiction row 4), so the server
// and the admin web share one list. A slice that writes a new code appends it there.
export { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES };
export type { AuditAction, AuditEntityType };

/** Longest action code; same limit as the `audit_logs_action_format` CHECK. */
export const AUDIT_ACTION_MAX_LENGTH = 64;

/**
 * Lower-case `group.verb` (brief G1): one dot, letters and underscores. Same pattern as the
 * `audit_logs_action_format` CHECK of migration `0003_audit_logs.sql`.
 */
export const AUDIT_ACTION_FORMAT = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

const ACTIONS: ReadonlySet<string> = new Set(AUDIT_ACTIONS);
const ENTITY_TYPES: ReadonlySet<string> = new Set(AUDIT_ENTITY_TYPES);

/** True for a code of the catalogue. */
export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && ACTIONS.has(value);
}

/** True for a value of the `audit_entity_type` enum. */
export function isAuditEntityType(value: unknown): value is AuditEntityType {
  return typeof value === 'string' && ENTITY_TYPES.has(value);
}
