// Strips secrets and contact data from an audit diff before it is written (data-model `audit_logs`:
// "diff never holds a password, code, token, full account number or contact", brief G8, L14).
// Only key names are read; values are never inspected except to shorten an account number.
// The rule errs on the side of removing a member: an audit row can never be corrected afterwards.

import { hasKeyWord, keyWords } from '../../common/privacy/personal-data-guard.js';

/**
 * Words that remove a member wherever they appear in its key (camelCase, snake_case, kebab-case,
 * any case, plural included): `passwordHash`, `new_password`, `accessToken`, `id_token`,
 * `totpSecret`, `otpCode`.
 */
const SECRET_WORDS: ReadonlySet<string> = new Set(['password', 'token', 'secret', 'otp']);

/**
 * Words of contact data: `phone`, `customerPhone`, `email`, `addressLine`, `contact_name`. A key
 * whose last word is a masked tail (`phoneLast4`, `customer_phone_last4`) is kept: it holds only the
 * last digits, not the full phone (api-divergences D-020).
 */
const CONTACT_WORDS: ReadonlySet<string> = new Set(['phone', 'email', 'address', 'contact']);

/**
 * Whole keys (words joined, lower case) removed as one-time codes. `code` alone is removed, so a
 * slice that audits a business code names the key after it (`branchCode`, `voucherCode`), which is
 * kept (api-divergences D-020).
 */
const CODE_KEYS: ReadonlySet<string> = new Set([
  'code',
  'codes',
  'recoverycode',
  'recoverycodes',
  'totpcode',
  'mfacode',
  'verificationcode',
]);

const MASKED_TAIL = /^last\d$/;

/** Digits an account number keeps (data-model `app_settings.payment`: the last 5 digits). */
export const ACCOUNT_NUMBER_KEPT_DIGITS = 5;

type KeyRule = 'keep' | 'strip' | 'account';

function ruleFor(key: string): KeyRule {
  const words = keyWords(key);
  const last = words.at(-1) ?? '';
  if (CODE_KEYS.has(words.join('')) || hasKeyWord(words, SECRET_WORDS)) {
    return 'strip';
  }
  if (hasKeyWord(words, CONTACT_WORDS) && !MASKED_TAIL.test(last)) {
    return 'strip';
  }
  if (last === 'number' && words.at(-2) === 'account') {
    return 'account';
  }
  return 'keep';
}

/** `accountNumber` → `accountNumberLast5`, `account_number` → `account_number_last5`. */
function accountKey(key: string): string {
  return key.includes('_')
    ? `${key}_last${ACCOUNT_NUMBER_KEPT_DIGITS}`
    : `${key}Last${ACCOUNT_NUMBER_KEPT_DIGITS}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reduces an account number to its last digits. A `{ from, to }` pair or an array is reduced member
 * by member; anything that is not a string or a number becomes `null`.
 */
function lastDigits(value: unknown): unknown {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    const digits = String(value).replace(/\D/g, '');
    return digits === '' ? null : digits.slice(-ACCOUNT_NUMBER_KEPT_DIGITS);
  }
  if (Array.isArray(value)) {
    return value.map(lastDigits);
  }
  if (isPlainObject(value) && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, lastDigits(member)]),
    );
  }
  return null;
}

function clean(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value !== 'object' || value === null || value instanceof Date) {
    return value;
  }
  if (ancestors.has(value)) {
    throw new Error('An audit diff is a JSON value and cannot contain a cycle.');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => clean(item, ancestors));
    }
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      const rule = ruleFor(key);
      if (rule === 'account') {
        result[accountKey(key)] = lastDigits(member);
      } else if (rule === 'keep') {
        result[key] = clean(member, ancestors);
      }
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Returns a copy of `diff` without secrets and contact data, at any depth (objects and arrays).
 * Removed: any key with the word password, token, secret or otp; the keys `code`, `codes` and the
 * recovery, TOTP, MFA and verification codes; any key with the word phone, email, address or
 * contact, unless its last word is a masked tail such as `last4`. An account number
 * (`accountNumber`, `account_number`, `bankAccountNumber`) becomes `<key>Last5` holding its last 5
 * digits. A diff with only safe members comes back equal. The input is not changed.
 */
export function sanitizeDiff(diff: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return clean(diff, new Set()) as Record<string, unknown>;
}
