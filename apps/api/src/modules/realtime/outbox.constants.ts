/**
 * Days an outbox row is kept after `created_at` (ADR-0007 resolved item 4; data-model,
 * "Personal data lifecycle"). The purge belongs to the jobs and relay tasks (A10, A12).
 */
export const OUTBOX_RETENTION_DAYS = 7;
