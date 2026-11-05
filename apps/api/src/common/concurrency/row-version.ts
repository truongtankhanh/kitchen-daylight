import type { StaleVersionActor, StaleVersionPayload } from '@kd/contracts';

import { ApiError } from '../errors/api-error.js';

/** The concurrency state of a record as it is now. */
export interface RowVersionState {
  readonly rowVersion: number;
  /** Display name, never an email; `null` for a system change. */
  readonly updatedBy: StaleVersionActor | null;
  readonly updatedAt: Date;
}

/** The `STALE_VERSION` member `current` of a record (decision 0007 section 7). */
export function staleVersionPayload(current: RowVersionState): StaleVersionPayload {
  return {
    current: {
      rowVersion: current.rowVersion,
      updatedBy:
        current.updatedBy === null
          ? null
          : { id: current.updatedBy.id, name: current.updatedBy.name },
      updatedAt: current.updatedAt.toISOString(),
    },
  };
}

/**
 * Optimistic concurrency check (decision 0007 section 7): the version the client read against the
 * current one. A mismatch → `409 STALE_VERSION` with `current { rowVersion, updatedBy, updatedAt }`.
 * The write itself still updates `WHERE id = $1 AND row_version = $2`; when it touches no row, the
 * service reads the record again and calls this with the fresh state.
 */
export function assertRowVersion(expected: number, current: RowVersionState): void {
  if (expected !== current.rowVersion) {
    throw new ApiError('STALE_VERSION', {
      detail: 'The record was changed by someone else.',
      extras: { ...staleVersionPayload(current) },
    });
  }
}
