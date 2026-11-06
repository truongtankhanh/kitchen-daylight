import { Inject, Injectable } from '@nestjs/common';
import { LessThanOrEqual } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ApiError } from '../errors/api-error.js';
import { assertNoPersonalData } from '../privacy/personal-data-guard.js';
import { Clock } from '../time/clock.js';
import { IdempotencyKeyRecord } from './entities/idempotency-key.entity.js';
import { hashRequest } from './request-hash.js';
import type { PathParams } from './request-hash.js';

/** Hours a key is kept after `created_at` (decision 0007 section 10, answered 2026-11-05). */
export const IDEMPOTENCY_RETENTION_HOURS = 24;

/** The header format of decision 0007 section 10; same rule as the `idempotency_keys_key_format` CHECK. */
export const IDEMPOTENCY_KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;

/** An operation name, `group.verb` or longer; same rule as the `idempotency_keys_scope_format` CHECK. */
const SCOPE_FORMAT = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
const SCOPE_MAX_LENGTH = 64;

/** The isolation level of the caller's transaction, checked first by `begin`. */
export const TRANSACTION_ISOLATION_SQL = `SELECT current_setting('transaction_isolation') AS isolation`;

/**
 * `begin` is correct only under Read Committed [PG-ISO]: in Repeatable Read or Serializable a
 * concurrent duplicate fails with SQLSTATE 40001 instead of replaying, and the follow-up read cannot
 * see the row that skipped the insert. A stricter level is a programming error, refused before any
 * write.
 */
async function assertReadCommitted(manager: EntityManager): Promise<void> {
  const rows: unknown = await manager.query(TRANSACTION_ISOLATION_SQL);
  const isolation = Array.isArray(rows)
    ? (rows[0] as { isolation?: unknown } | undefined)?.isolation
    : undefined;
  if (isolation !== 'read committed') {
    throw new Error(
      `IdempotencyService.begin needs a Read Committed transaction, not ${String(isolation)}.`,
    );
  }
}

/**
 * Inserts the key unless one exists for the same (scope, actor, key). With a concurrent
 * uncommitted insert of the same values, PostgreSQL makes this statement wait until that
 * transaction ends, then skips the row if it committed and inserts if it rolled back [PG-UNIQUE].
 * `RETURNING` gives a row only when one was inserted [PG-INSERT].
 */
export const INSERT_KEY_SQL = `INSERT INTO public.idempotency_keys
  (scope, actor_id, key, request_hash, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (scope, actor_id, key) DO NOTHING
RETURNING id`;

/** Which stored key: the operation, the acting user (from the token) and the header value. */
export interface IdempotencyKeyRef {
  readonly scope: string;
  readonly actorId: string;
  readonly key: string;
}

/** What `begin` hashes: the request the key stands for (`hashRequest`). */
export interface IdempotencyBeginInput extends IdempotencyKeyRef {
  readonly method: string;
  readonly routeTemplate: string;
  /**
   * The route's path parameters (`{ id }` of `/admin/users/{id}/points`), `{}` when it has none.
   * Required, so a route whose parameter selects the target cannot forget it (api-divergences D-023).
   */
  readonly pathParams: PathParams;
  /** The validated request body. */
  readonly requestBody: unknown;
}

/** The first result of a key: its status and a non-personal reference such as `{ orderId }`. */
export interface IdempotencyResult {
  readonly status: number;
  readonly ref: Readonly<Record<string, unknown>>;
}

/** `proceed`: run the operation and call `complete`. `replay`: read the referenced resource now. */
export type IdempotencyOutcome =
  { readonly kind: 'proceed' } | ({ readonly kind: 'replay' } & IdempotencyResult);

function assertKeyRef(ref: IdempotencyKeyRef): void {
  if (
    typeof ref.scope !== 'string' ||
    ref.scope.length > SCOPE_MAX_LENGTH ||
    !SCOPE_FORMAT.test(ref.scope)
  ) {
    throw new Error('An idempotency scope is a lower-case operation name such as orders.create.');
  }
  if (typeof ref.actorId !== 'string' || ref.actorId === '') {
    throw new Error('An idempotency actorId is the acting user id from the token.');
  }
  // The decorator has already validated the header; this guards a caller that skipped it.
  if (typeof ref.key !== 'string' || !IDEMPOTENCY_KEY_FORMAT.test(ref.key)) {
    throw new Error('An idempotency key must be read with @IdempotencyKey().');
  }
}

function assertResult(result: IdempotencyResult): void {
  if (!Number.isInteger(result.status) || result.status < 200 || result.status > 299) {
    throw new Error('An idempotency result stores a 2xx status: a failed request rolls back.');
  }
  const ref: unknown = result.ref;
  if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) {
    throw new Error('An idempotency ref is a JSON object of ids.');
  }
  assertNoPersonalData(ref);
}

/**
 * The `Idempotency-Key` store (decision 0007 section 10). Every method takes the caller's
 * `EntityManager`, so the row lives and dies with the business transaction. Requires PostgreSQL's
 * default isolation, Read Committed: there, a statement that follows the skipped insert sees the row
 * the concurrent transaction committed [PG-ISO].
 *
 * Sources, PostgreSQL 18 documentation, read 2026-11-05:
 * - [PG-UNIQUE] https://www.postgresql.org/docs/18/index-unique-checks.html: "If a conflicting row
 *   has been inserted by an as-yet-uncommitted transaction, the would-be inserter must wait to see
 *   if that transaction commits. If it rolls back then there is no conflict."
 * - [PG-INSERT] https://www.postgresql.org/docs/18/sql-insert.html: "ON CONFLICT DO NOTHING simply
 *   avoids inserting a row as its alternative action"; RETURNING returns "each row actually inserted".
 * - [PG-ISO] https://www.postgresql.org/docs/18/transaction-iso.html: "INSERT with an ON CONFLICT DO
 *   NOTHING clause may have insertion not proceed for a row due to the outcome of another transaction
 *   whose effects are not visible to the INSERT snapshot. Again, this is only the case in Read
 *   Committed mode", which "starts each command with a new snapshot that includes all transactions
 *   committed up to that instant".
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(Clock) private readonly clock: Clock) {}

  /**
   * Call first in the business transaction. Returns `proceed` when the key is new (or its row had
   * expired and was replaced), `replay` with the stored result when the same request already
   * succeeded, and throws `ApiError` `IDEMPOTENCY_CONFLICT` (409) when the key was used with a
   * different request. A concurrent duplicate waits for the first transaction, then replays; if the
   * first rolled back, it proceeds. Refuses (programmer error) a transaction that is not Read
   * Committed.
   */
  async begin(manager: EntityManager, input: IdempotencyBeginInput): Promise<IdempotencyOutcome> {
    assertKeyRef(input);
    await assertReadCommitted(manager);
    const where = { scope: input.scope, actorId: input.actorId, key: input.key };
    const requestHash = hashRequest(
      input.method,
      input.routeTemplate,
      input.requestBody,
      input.pathParams,
    );
    const now = this.clock.now();

    let stored = await manager.findOneBy(IdempotencyKeyRecord, where);
    if (stored !== null && stored.expiresAt.getTime() <= now.getTime()) {
      // A key older than its retention is a new intent: replace it, never replay it.
      await manager.delete(IdempotencyKeyRecord, { id: stored.id });
      stored = null;
    }

    if (stored === null) {
      const expiresAt = new Date(now.getTime() + IDEMPOTENCY_RETENTION_HOURS * 3_600_000);
      const inserted: unknown = await manager.query(INSERT_KEY_SQL, [
        input.scope,
        input.actorId,
        input.key,
        requestHash,
        now,
        expiresAt,
      ]);
      if (Array.isArray(inserted) && inserted.length === 1) {
        return { kind: 'proceed' };
      }
      // Skipped: a concurrent transaction committed this key while the insert waited.
      stored = await manager.findOneBy(IdempotencyKeyRecord, where);
      if (stored === null) {
        throw new Error(
          'The idempotency key vanished after a conflicting insert; retry the request.',
        );
      }
    }

    if (stored.requestHash !== requestHash) {
      throw new ApiError('IDEMPOTENCY_CONFLICT', {
        detail: 'This Idempotency-Key was already used with a different request.',
      });
    }
    if (
      stored.completedAt === null ||
      stored.responseStatus === null ||
      stored.responseRef === null
    ) {
      throw new Error(
        'The idempotency key has no result: begin ran twice in one transaction, or complete was not called before commit.',
      );
    }
    // An object by the `idempotency_keys_response_ref_object` CHECK.
    const storedRef = stored.responseRef as Readonly<Record<string, unknown>>;
    return { kind: 'replay', status: stored.responseStatus, ref: storedRef };
  }

  /**
   * Stores the result of a key that `begin` answered `proceed`, in the same transaction, before
   * commit. Refuses (programmer error) a non-2xx status, a `ref` that is not an object or that holds
   * a personal-data key (`assertNoPersonalData`), and a key that was not begun or is already complete.
   */
  async complete(
    manager: EntityManager,
    ref: IdempotencyKeyRef,
    result: IdempotencyResult,
  ): Promise<void> {
    assertKeyRef(ref);
    assertResult(result);
    const stored = await manager.findOneBy(IdempotencyKeyRecord, {
      scope: ref.scope,
      actorId: ref.actorId,
      key: ref.key,
    });
    if (stored === null || stored.completedAt !== null) {
      throw new Error('complete needs a key that begin answered with proceed in this transaction.');
    }
    await manager.update(
      IdempotencyKeyRecord,
      { id: stored.id },
      {
        responseStatus: result.status,
        responseRef: { ...result.ref },
        completedAt: this.clock.now(),
      },
    );
  }

  /** Deletes every expired key and returns how many; called by the jobs of A12-T2. */
  async deleteExpired(manager: EntityManager): Promise<number> {
    const result = await manager.delete(IdempotencyKeyRecord, {
      expiresAt: LessThanOrEqual(this.clock.now()),
    });
    return result.affected ?? 0;
  }
}
