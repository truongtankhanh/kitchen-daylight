import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { isAuditAction, isAuditEntityType } from './audit-actions.js';
import type { AuditAction, AuditEntityType } from './audit-actions.js';
import { AuditLog } from './entities/audit-log.entity.js';
import { sanitizeDiff } from './sanitize-diff.js';

/** Longest `entity_id`; same limit as the `audit_logs_entity_id_length` CHECK. */
export const AUDIT_ENTITY_ID_MAX_LENGTH = 128;

/** Longest `entity_label`; same limit as the `audit_logs_entity_label_length` CHECK. */
export const AUDIT_ENTITY_LABEL_MAX_LENGTH = 200;

/**
 * Something shaped like an email address anywhere in the text. Same pattern as the
 * `audit_logs_entity_label_not_email` CHECK of migration `0003_audit_logs.sql`.
 */
const EMAIL_LIKE = /[A-Za-z0-9._%+-]@[A-Za-z0-9-]+\.[A-Za-z0-9-]/;

/** What a service hands to `AuditService.write`. */
export interface AuditEntry {
  /** The acting user, taken from the token; `null` for a system action, never left out. */
  readonly actorUserId: string | null;
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  /** The record id, or its key for a keyed record (a settings key). */
  readonly entityId: string;
  /** Readable name stored at write time (order number, item name, display name); never an email. */
  readonly entityLabel?: string | null;
  /** Required for every branch-specific action, so the branch manager sees it (brief G5). */
  readonly branchId?: string | null;
  /** Before and after values; sanitized by `sanitizeDiff` before writing. */
  readonly diff?: Readonly<Record<string, unknown>>;
}

/**
 * Refuses (programmer error) a label that is empty, too long or looks like an email: data-model
 * `audit_logs` keeps the display name of a user, never the email (brief G4). The message never
 * repeats the label.
 */
export function assertEntityLabel(label: string | null | undefined): void {
  if (label === null || label === undefined) {
    return;
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error('An audit entityLabel is a non-empty string or null.');
  }
  if (label.length > AUDIT_ENTITY_LABEL_MAX_LENGTH) {
    throw new Error(
      `An audit entityLabel is at most ${AUDIT_ENTITY_LABEL_MAX_LENGTH} characters long.`,
    );
  }
  if (EMAIL_LIKE.test(label)) {
    throw new Error(
      'An audit entityLabel must not be an email address; use the display name (brief G4).',
    );
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Checks an entry from an untyped (or cast) caller before anything is written. */
function assertEntry(entry: AuditEntry): void {
  if (!isAuditAction(entry.action)) {
    throw new Error('Audit action is not a code of the AuditAction catalogue.');
  }
  if (!isAuditEntityType(entry.entityType)) {
    throw new Error('Audit entityType is not a value of AuditEntityType.');
  }
  if (!isNonEmptyString(entry.entityId) || entry.entityId.length > AUDIT_ENTITY_ID_MAX_LENGTH) {
    throw new Error(
      `An audit entityId is a non-empty string of at most ${AUDIT_ENTITY_ID_MAX_LENGTH} characters.`,
    );
  }
  if (entry.actorUserId !== null && !isNonEmptyString(entry.actorUserId)) {
    throw new Error('An audit actorUserId is the acting user id, or null for a system action.');
  }
  const branchId = entry.branchId ?? null;
  if (branchId !== null && !isNonEmptyString(branchId)) {
    throw new Error('An audit branchId is a branch id or null.');
  }
  const diff: unknown = entry.diff ?? {};
  if (typeof diff !== 'object' || diff === null || Array.isArray(diff)) {
    throw new Error('An audit diff is a JSON object.');
  }
  assertEntityLabel(entry.entityLabel);
}

/**
 * Writes `audit_logs` rows (decision 0007 section 3). The table is append-only: this service only
 * inserts. Reading the trail is the viewer's job (A12-T7).
 */
@Injectable()
export class AuditService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Inserts one audit row. With `manager`, the row joins the caller's transaction and commits or
   * rolls back with the business change; without it, the row is written on its own (for an action
   * with no business write, such as a contact reveal). The entry is checked and its `diff`
   * sanitized before the insert; a failed insert reaches the caller.
   */
  async write(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    assertEntry(entry);
    const target = manager ?? this.dataSource.manager;
    await target.insert(AuditLog, {
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel ?? null,
      branchId: entry.branchId ?? null,
      diff: sanitizeDiff(entry.diff ?? {}),
    });
  }
}
