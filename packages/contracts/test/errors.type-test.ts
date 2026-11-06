// Type-level test of the error catalogue (decision 0007 section 9). Checked by `typecheck`; nothing runs.
import type {
  ERROR_CODES,
  ERROR_STATUS,
  ErrorCode,
  FIELD_ERROR_CODES,
  FieldErrorCode,
} from '../src/errors.js';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails when a code has no status, or when a status is mapped for a name that is not a code. */
export type EveryCodeHasAStatus = Assert<Equal<keyof typeof ERROR_STATUS, ErrorCode>>;

/** Every status is an HTTP error status. */
export type StatusesAreErrors = Assert<
  Equal<
    Extract<
      (typeof ERROR_STATUS)[ErrorCode],
      400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503
    >,
    (typeof ERROR_STATUS)[ErrorCode]
  >
>;

/** 18 codes "unchanged from v2" plus the 26 of the table; a duplicate would leave the union shorter. */
export type ErrorCatalogueLength = Assert<Equal<(typeof ERROR_CODES)['length'], 44>>;

/**
 * The 29 field-level codes of the outline plus `INVALID` (api-divergences D-001),
 * `INVALID_FORMAT` (decision 0007 row 14, D-022) and `TOO_SHORT` (D-037).
 */
export type FieldCatalogueLength = Assert<Equal<(typeof FIELD_ERROR_CODES)['length'], 32>>;

/** The unions are exactly the arrays. */
export type ErrorCodeIsTheArray = Assert<Equal<ErrorCode, (typeof ERROR_CODES)[number]>>;
export type FieldErrorCodeIsTheArray = Assert<
  Equal<FieldErrorCode, (typeof FIELD_ERROR_CODES)[number]>
>;
