import type { ApiFieldError } from '../../common/errors/api-error.js';
import type { UserRole } from './entities/user.entity.js';

/** Who the password belongs to: customers (mobile) or staff (`STAFF`, `MANAGER`, `ADMIN`). */
export type PasswordAudience = 'customer' | 'staff';

/** Minimum lengths of ADR-0003 (customers 10, staff 12), in Unicode code points after NFC. */
export const PASSWORD_MIN_LENGTH: Readonly<Record<PasswordAudience, number>> = {
  customer: 10,
  staff: 12,
};

/** Maximum length for both audiences (ADR-0003; decision 0008 section 4). */
export const PASSWORD_MAX_LENGTH = 128;

/** The field the errors are reported on. */
export const PASSWORD_FIELD = 'password';

export function passwordAudienceOf(role: UserRole): PasswordAudience {
  return role === 'CUSTOMER' ? 'customer' : 'staff';
}

/**
 * NFC normalisation, applied before counting and before hashing (decision 0008 section 4). Fixed
 * from the first stored hash: changing it would break every existing hash. No trimming.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/** Length in Unicode code points of the NFC form, not UTF-16 units or bytes. */
export function passwordLength(password: string): number {
  // The string iterator yields code points, so a surrogate pair counts once.
  return Array.from(normalizePassword(password)).length;
}

/**
 * The phase 1 length policy (decision 0008 section 4): no composition rules, whitespace and any
 * Unicode allowed. Returns the field errors, empty when the password is acceptable. The messages
 * never repeat the password.
 */
export function checkPasswordPolicy(password: string, audience: PasswordAudience): ApiFieldError[] {
  const length = passwordLength(password);
  const minimum = PASSWORD_MIN_LENGTH[audience];
  if (length < minimum) {
    return [
      {
        field: PASSWORD_FIELD,
        code: 'TOO_SHORT',
        message: `must be at least ${minimum} characters`,
      },
    ];
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return [
      {
        field: PASSWORD_FIELD,
        code: 'TOO_LONG',
        message: `must be at most ${PASSWORD_MAX_LENGTH} characters`,
      },
    ];
  }
  return [];
}
