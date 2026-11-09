// Type-level test of the outbox event helpers (A0-T6). Checked by `typecheck`; nothing runs.
import type {
  OUTBOX_AUDIENCES,
  OutboxAudience,
  OutboxEventInput,
  OutboxEventOf,
  RealtimeEventMap,
} from '../src/events.js';
import { outboxEvent } from '../src/events.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The four audiences of `outbox_events.audience`, and the union is exactly the array. */
export type AudienceCount = Assert<Equal<(typeof OUTBOX_AUDIENCES)['length'], 4>>;
export type AudienceIsTheArray = Assert<
  Equal<OutboxAudience, 'PUBLIC' | 'BRANCH_STAFF' | 'ADMIN' | 'USER'>
>;

/** The events registered so far (A3-T4, A4-T3, A5-T5); A10-T2 completes the list. */
export type RegisteredEvents = Assert<
  Equal<
    keyof RealtimeEventMap,
    'user.suspended' | 'session.revoked' | 'config.changed' | 'branch.updated'
  >
>;
export type TypedRowType = Assert<
  Equal<OutboxEventInput<'session.revoked'>['type'], 'session.revoked'>
>;

const SIGNED_OUT = '0199a3c0-0000-7000-8000-0000000000d1';
export const revokedEvent = outboxEvent({
  type: 'session.revoked',
  entityType: 'user',
  entityId: SIGNED_OUT,
  audience: 'USER',
  audienceUserId: SIGNED_OUT,
  payload: { userId: SIGNED_OUT, reason: 'ROLE_CHANGE' },
});
export const suspendedEvent = outboxEvent({
  type: 'user.suspended',
  entityType: 'user',
  entityId: SIGNED_OUT,
  audience: 'USER',
  audienceUserId: SIGNED_OUT,
  payload: { userId: SIGNED_OUT },
});
// @ts-expect-error The payload follows the registered event type.
export const wrongReason = outboxEvent({ type: 'session.revoked', entityType: 'user', entityId: SIGNED_OUT, audience: 'USER', audienceUserId: SIGNED_OUT, payload: { userId: SIGNED_OUT, reason: 'OTHER' } }); // prettier-ignore

// A sample event, standing in for an entry of RealtimeEventMap.
type Sample = OutboxEventOf<'sample.changed', { sampleId: string; rowVersion: number }>;
const base = {
  type: 'sample.changed',
  entityType: 'sample',
  entityId: '0199a3c0-0000-7000-8000-000000000001',
  version: 2,
  payload: { sampleId: '0199a3c0-0000-7000-8000-000000000001', rowVersion: 2 },
} as const;
const BRANCH = '0199a3c0-0000-7000-8000-0000000000b1';
const USER = '0199a3c0-0000-7000-8000-0000000000c1';

export const publicEvent: Sample = { ...base, audience: 'PUBLIC' };
export const adminEvent: Sample = { ...base, audience: 'ADMIN' };
export const staffEvent: Sample = { ...base, audience: 'BRANCH_STAFF', branchId: BRANCH };
export const userEvent: Sample = { ...base, audience: 'USER', audienceUserId: USER };

// @ts-expect-error BRANCH_STAFF needs its branch.
export const staffWithoutBranch: Sample = { ...base, audience: 'BRANCH_STAFF' };
// @ts-expect-error USER needs its user.
export const userWithoutUser: Sample = { ...base, audience: 'USER' };
// @ts-expect-error PUBLIC names no branch.
export const publicWithBranch: Sample = { ...base, audience: 'PUBLIC', branchId: BRANCH };
// Kept on one line each, so every @ts-expect-error sits on the line that fails.
const both = { branchId: BRANCH, audienceUserId: USER } as const;
const badPayload = { sampleId: 1, rowVersion: 2 } as const;
// @ts-expect-error A branch event names no user.
export const staffWithUser: Sample = { ...base, audience: 'BRANCH_STAFF', ...both };
// @ts-expect-error The payload follows the event type.
export const wrongPayload: Sample = { ...base, audience: 'PUBLIC', payload: badPayload };
