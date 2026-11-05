import type { EstimatedTotal } from '@kd/contracts';

/** Cap of `estimatedTotal` (api-outline, "Pagination": capped at 1.000). */
export const ESTIMATED_TOTAL_CAP = 1000;

const DIGITS = /^\d+$/;

/**
 * `estimatedTotal` of a cursor list (decision 0007 section 6) from a bounded count. The list runs
 * its own filters through a count that stops after `cap + 1` rows, so the cost never grows with
 * the table:
 *
 * ```sql
 * SELECT count(*) AS count FROM (SELECT 1 FROM <table> WHERE <same filters> LIMIT 1001) s
 * ```
 *
 * `count(*)` is a `bigint`, which the `pg` driver returns as a string; both forms are accepted.
 * Returns `{ value: min(count, cap), capped: count > cap }`.
 */
export function toEstimatedTotal(
  count: number | string,
  cap: number = ESTIMATED_TOTAL_CAP,
): EstimatedTotal {
  // `Number('')` and `Number(' ')` are 0, so a string must be digits only.
  const rows = typeof count === 'string' ? (DIGITS.test(count) ? Number(count) : NaN) : count;
  if (!Number.isSafeInteger(rows) || rows < 0) {
    throw new RangeError('The bounded count must be a non-negative safe integer.');
  }
  return rows > cap ? { value: cap, capped: true } : { value: rows, capped: false };
}
