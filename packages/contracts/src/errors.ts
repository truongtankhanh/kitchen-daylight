// The stable error catalogue of the API (api-outline, "Error code catalogue (stable)").
// Names never change inside `v1`; each slice adds the codes it returns (decision 0007 section 9).

/**
 * Every `code` of a problem+json body: the 18 codes "unchanged from v2", then the 26 of the
 * catalogue table, in the outline's order.
 */
export const ERROR_CODES = [
  // Unchanged from v2.
  'VALIDATION_FAILED',
  'CODE_INVALID',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_SUSPENDED',
  'NOT_FOUND',
  'STALE_VERSION',
  'ALREADY_EXISTS',
  'IN_USE',
  'UPGRADE_REQUIRED',
  'RATE_LIMITED',
  'MAINTENANCE',
  'LAST_ADMIN',
  'SELF_CHANGE',
  'REVIEW_EXISTS',
  // The catalogue table.
  'BRANCH_CLOSED',
  'ITEM_UNAVAILABLE',
  'PRICE_CHANGED',
  'OPTION_INVALID',
  'OUT_OF_ZONE',
  'BELOW_MIN_ORDER',
  'PHONE_REQUIRED',
  'VOUCHER_INVALID',
  'INSUFFICIENT_POINTS',
  'INVALID_TRANSITION',
  'ORDER_NOT_CANCELLABLE',
  'PAYMENT_NOT_CONFIRMED',
  'ORDER_NOT_REVIEWABLE',
  'SLOT_UNAVAILABLE',
  'HAS_ACTIVE_ORDERS',
  'MFA_REQUIRED',
  'ORDER_NOT_EDITABLE',
  'INVALID_STATE',
  'MFA_NOT_ENABLED',
  'REVIEW_NOT_PUBLISHED',
  'DUPLICATE_REPORT',
  'IDEMPOTENCY_CONFLICT',
  'DUPLICATE_RESERVATION',
  'TOO_LARGE',
  'UNSUPPORTED_TYPE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * HTTP status of every code. The catalogue table gives the status of its 26 codes; the 18 codes
 * "unchanged from v2" take the table of decision 0007 section 9 (the outline gives none).
 */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  CODE_INVALID: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_SUSPENDED: 403,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
  ALREADY_EXISTS: 409,
  IN_USE: 409,
  UPGRADE_REQUIRED: 400,
  RATE_LIMITED: 429,
  MAINTENANCE: 503,
  LAST_ADMIN: 409,
  SELF_CHANGE: 403,
  REVIEW_EXISTS: 409,
  BRANCH_CLOSED: 409,
  ITEM_UNAVAILABLE: 409,
  PRICE_CHANGED: 409,
  OPTION_INVALID: 409,
  OUT_OF_ZONE: 422,
  BELOW_MIN_ORDER: 422,
  PHONE_REQUIRED: 422,
  VOUCHER_INVALID: 409,
  INSUFFICIENT_POINTS: 409,
  INVALID_TRANSITION: 409,
  ORDER_NOT_CANCELLABLE: 409,
  PAYMENT_NOT_CONFIRMED: 409,
  ORDER_NOT_REVIEWABLE: 409,
  SLOT_UNAVAILABLE: 409,
  HAS_ACTIVE_ORDERS: 409,
  MFA_REQUIRED: 403,
  ORDER_NOT_EDITABLE: 409,
  INVALID_STATE: 409,
  MFA_NOT_ENABLED: 409,
  REVIEW_NOT_PUBLISHED: 409,
  DUPLICATE_REPORT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DUPLICATE_RESERVATION: 409,
  TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  INTERNAL_ERROR: 500,
} as const satisfies Readonly<Record<ErrorCode, number>>;

export type ErrorStatus = (typeof ERROR_STATUS)[ErrorCode];

/**
 * Every `errors[].code` inside `VALIDATION_FAILED`: the 29 field-level codes of the outline, in its
 * order, then `INVALID` for a rule the catalogue has no code for (api-divergences D-001).
 */
export const FIELD_ERROR_CODES = [
  'REQUIRED',
  'TOO_LONG',
  'OUT_OF_RANGE',
  'INVALID_PHONE',
  'INVALID_EMAIL',
  'INVALID_TAX_CODE',
  'MUST_BE_LESS_THAN_LATE',
  'MUST_EXCEED_ACCEPT_LATE',
  'RANGE_TOO_WIDE',
  'RANGE_INVALID',
  'INVALID_CURSOR',
  'TOO_MANY',
  'LIMIT_REACHED',
  'STOCK_NEGATIVE',
  'MIN_GT_MAX',
  'DEFAULT_REQUIRED',
  'DEFAULT_EXCEEDS_MAX',
  'NOT_ENOUGH_ACTIVE',
  'LOCKED',
  'OVERLAP',
  'EQUAL_TIMES',
  'INVALID_TIME',
  'RADIUS_ORDER',
  'LAST_ACTIVE_ZONE',
  'TOO_MANY_ROWS',
  'OUTSIDE_OPENING_HOURS',
  'TOO_SOON',
  'TOO_FAR',
  'PARTY_TOO_LARGE',
  // Not in the outline: the generic code of api-divergences D-001.
  'INVALID',
] as const;

export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

/** Who last changed a record: the display name, never an email. */
export interface StaleVersionActor {
  id: string;
  name: string;
}

/**
 * Code-specific member of `STALE_VERSION` (409): the record as it is now (api-outline, "Payloads
 * added to existing codes"; decision 0007 section 7). `updatedBy` is `null` for a system change;
 * `updatedAt` is an ISO 8601 instant. A settings key adds its current `value` (A4-T2).
 */
export interface StaleVersionPayload {
  current: {
    rowVersion: number;
    updatedBy: StaleVersionActor | null;
    updatedAt: string;
  };
}
