// Masked contact for staff screens (api-outline, Conventions "Privacy": lists show the masked
// version, the full value only through an audited `reveal-contact`). The documents give no format;
// this one is logged in api-divergences D-090. Pure functions: no I/O, no logging.

/** What replaces each hidden character. */
export const MASK_CHAR = '*';
/** Hidden characters of an email local part, whatever its length, so the length does not leak. */
const EMAIL_LOCAL_MASK = MASK_CHAR.repeat(3);
/** Digits of a phone number left visible at the end. */
export const PHONE_VISIBLE_DIGITS = 3;
/** The country code kept at the start of a Vietnamese number. */
const VIETNAM_PREFIX = '+84';

/**
 * `nguyen.van.a@example.com` → `n***@example.com`: the first character of the local part, then
 * always three `*`, then the domain unchanged (it names the mail provider, not the person). A
 * value without a usable `@` is masked entirely (`***`). `null` stays `null`.
 */
export function maskEmail(email: string | null): string | null {
  if (email === null) {
    return null;
  }
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) {
    return EMAIL_LOCAL_MASK;
  }
  const first = Array.from(email.slice(0, at))[0] ?? '';
  return `${first}${EMAIL_LOCAL_MASK}${email.slice(at)}`;
}

/**
 * An E.164 number with every digit hidden except the last three; a leading `+84` is kept:
 * `+84901234567` → `+84******567`, `+6591234567` → `+*******567`. Fewer than four digits: every
 * digit hidden. `null` stays `null`.
 */
export function maskPhone(phone: string | null): string | null {
  if (phone === null) {
    return null;
  }
  const prefix = phone.startsWith(VIETNAM_PREFIX)
    ? VIETNAM_PREFIX
    : phone.startsWith('+')
      ? '+'
      : '';
  const digits = phone.slice(prefix.length).replace(/\D/gu, '');
  const visible = digits.length > PHONE_VISIBLE_DIGITS ? PHONE_VISIBLE_DIGITS : 0;
  const hidden = digits.length - visible;
  return `${prefix}${MASK_CHAR.repeat(hidden)}${digits.slice(hidden)}`;
}
