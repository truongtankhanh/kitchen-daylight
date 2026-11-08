// Realtime event types (decision 0004 section 6).
// - The API gateway and both clients import them only from `@kd/contracts` and never redeclare
//   them locally.
// - This file imports nothing from `src/generated/**` or `src/client.ts`.
// - Rule: the first task that emits an event adds its entry to `RealtimeEventMap` (name → payload)
//   in the same change; A10-T2 completes the list and audits every write path that emits.
// - A payload is a signal (ADR-0007, "signal, then fetch"): ids, statuses, versions and counts,
//   never personal data or record content.

/**
 * `user.suspended`: an admin suspended the account (A3-T4); audience `USER`, the account itself.
 * The client signs out at once (api-outline, Realtime).
 */
export interface UserSuspendedPayload {
  userId: string;
}

/** Why every session of a user was revoked by an admin action (A3-T4). */
export type SessionRevokedReason = 'ROLE_CHANGE' | 'MFA_RESET';

/**
 * `session.revoked`: every refresh-token family of the user was revoked by an admin (role change
 * or MFA reset; A3-T4); audience `USER`. The client signs out at once (api-outline, Realtime).
 */
export interface SessionRevokedPayload {
  userId: string;
  reason: SessionRevokedReason;
}

/**
 * `config.changed`: an admin saved a settings key (A4-T3); audience `PUBLIC`. `keys` are the API
 * names of the saved keys (for example `maintenance`, `minAppVersion`, `featureFlags`) and
 * `version` the new row version; never a value or the editor (api-outline, Realtime; brief L9).
 * The API writes one outbox row per saved key with one key; the relay (A10-T3) may fold rows into
 * one event. The customer app refetches `GET /meta/config`, the admin web `GET /admin/meta/config`.
 */
export interface ConfigChangedPayload {
  keys: string[];
  version: number;
}

/** Map of realtime event name to payload type. A10-T2 completes the list. */
export interface RealtimeEventMap {
  'user.suspended': UserSuspendedPayload;
  'session.revoked': SessionRevokedPayload;
  'config.changed': ConfigChangedPayload;
}

/** Who receives an outbox event (data-model, `outbox_events.audience`). */
export const OUTBOX_AUDIENCES = ['PUBLIC', 'BRANCH_STAFF', 'ADMIN', 'USER'] as const;

export type OutboxAudience = (typeof OUTBOX_AUDIENCES)[number];

/**
 * The audience and its scope, one member per audience: `BRANCH_STAFF` names the branch, `USER`
 * names the user, and the other audiences name neither (the `CHECK`s of `outbox_events`).
 */
export type OutboxAudienceScope =
  | { audience: 'PUBLIC'; branchId?: null; audienceUserId?: null }
  | { audience: 'ADMIN'; branchId?: null; audienceUserId?: null }
  | { audience: 'BRANCH_STAFF'; branchId: string; audienceUserId?: null }
  | { audience: 'USER'; audienceUserId: string; branchId?: null };

/** One outbox row for an event `Type` with payload `Payload`, discriminated by audience. */
export type OutboxEventOf<Type extends string, Payload extends object> = OutboxAudienceScope & {
  type: Type;
  /** Kind of record the event is about, for example `order` or `app_settings`. */
  entityType: string;
  /** Its id, or a key for keyed records such as a settings key. */
  entityId: string;
  /** The record's `rowVersion` after the change, when it has one. */
  version?: number | null;
  payload: Payload;
};

/** An outbox row for an event of `RealtimeEventMap`. */
export type OutboxEventInput<K extends keyof RealtimeEventMap> = OutboxEventOf<
  K & string,
  RealtimeEventMap[K] & object
>;

/**
 * Typed builder: returns its argument, checked against `RealtimeEventMap`, so an emitting service
 * cannot misspell an event or send the wrong payload. Callable once the map has an entry.
 */
export function outboxEvent<K extends keyof RealtimeEventMap>(
  event: OutboxEventInput<K>,
): OutboxEventInput<K> {
  return event;
}
