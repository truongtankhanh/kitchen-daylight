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
 * Whether the password is the account email or its local part, case-insensitively after NFC
 * (decision 0008 section 4). The email is compared in its stored form (trimmed, lower case); the
 * password is not trimmed, as everywhere else.
 */
export function matchesAccountEmail(password: string, email: string): boolean {
  const candidate = normalizePassword(password).toLowerCase();
  const address = email.trim().normalize('NFC').toLowerCase();
  const at = address.lastIndexOf('@');
  const localPart = at > 0 ? address.slice(0, at) : '';
  return candidate === address || (localPart !== '' && candidate === localPart);
}

/**
 * The phase 1 policy (decision 0008 section 4): the length limits, then the account email rule. No
 * composition rules, whitespace and any Unicode allowed. Returns the field errors, empty when the
 * password is acceptable. The messages never repeat the password or the email.
 */
export function checkPasswordPolicy(
  password: string,
  audience: PasswordAudience,
  accountEmail: string,
): ApiFieldError[] {
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
  if (matchesAccountEmail(password, accountEmail)) {
    return [
      {
        field: PASSWORD_FIELD,
        // The generic field code (api-divergences D-001): the catalogue has none for this rule.
        code: 'INVALID',
        message: 'must not be the account email or the part before @',
      },
    ];
  }
  return [];
}
