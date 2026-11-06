import { describe, expect, it } from 'vitest';

import {
  checkPasswordPolicy,
  matchesAccountEmail,
  normalizePassword,
  passwordAudienceOf,
  passwordLength,
} from './password-policy.js';

/** Fictional account email; its local part is long enough to pass both length minimums. */
const EMAIL = 'fixture.policy.owner@example.com';
const LOCAL_PART = 'fixture.policy.owner';

const ascii = (length: number): string => 'a'.repeat(length);
/** One code point, two UTF-16 units. */
const emoji = (length: number): string => '\u{1F600}'.repeat(length);
/** Written as code points so no editor can normalise them away. */
const COMBINING_ACUTE = String.fromCodePoint(0x0301);
const E_ACUTE = String.fromCodePoint(0x00e9);
/** `e` + combining acute: two code points, one after NFC. */
const decomposed = (length: number): string => `e${COMBINING_ACUTE}`.repeat(length);

const tooShort = (minimum: number) => [
  { field: 'password', code: 'TOO_SHORT', message: `must be at least ${minimum} characters` },
];
const tooLong = [
  { field: 'password', code: 'TOO_LONG', message: 'must be at most 128 characters' },
];

describe('checkPasswordPolicy', () => {
  it.each([
    [9, tooShort(10), tooShort(12)],
    [10, [], tooShort(12)],
    [11, [], tooShort(12)],
    [12, [], []],
    [128, [], []],
    [129, tooLong, tooLong],
  ])('%i characters: customer %j, staff %j', (length, customer, staff) => {
    expect(checkPasswordPolicy(ascii(length), 'customer', EMAIL)).toEqual(customer);
    expect(checkPasswordPolicy(ascii(length), 'staff', EMAIL)).toEqual(staff);
  });

  it('counts code points, not UTF-16 units', () => {
    expect(emoji(10)).toHaveLength(20);
    expect(checkPasswordPolicy(emoji(9), 'customer', EMAIL)).toEqual(tooShort(10));
    expect(checkPasswordPolicy(emoji(10), 'customer', EMAIL)).toEqual([]);
    expect(checkPasswordPolicy(emoji(128), 'staff', EMAIL)).toEqual([]);
    expect(checkPasswordPolicy(emoji(129), 'staff', EMAIL)).toEqual(tooLong);
  });

  it('counts after NFC, so a decomposed accent is one character', () => {
    expect(decomposed(10)).toHaveLength(20);
    expect(checkPasswordPolicy(decomposed(9), 'customer', EMAIL)).toEqual(tooShort(10));
    expect(checkPasswordPolicy(decomposed(10), 'customer', EMAIL)).toEqual([]);
    expect(checkPasswordPolicy(decomposed(128), 'customer', EMAIL)).toEqual([]);
    expect(checkPasswordPolicy(decomposed(129), 'customer', EMAIL)).toEqual(tooLong);
  });

  it('has no composition rule and keeps whitespace', () => {
    expect(checkPasswordPolicy(' '.repeat(10), 'customer', EMAIL)).toEqual([]);
    expect(checkPasswordPolicy('mật khẩu dài', 'staff', EMAIL)).toEqual([]);
  });

  it('never repeats the password in a message', () => {
    const input = 'fixture-short';
    for (const error of checkPasswordPolicy(input, 'staff', EMAIL)) {
      expect(error.message).not.toContain(input);
    }
  });
});

describe('the account email rule (decision 0008 section 4)', () => {
  const sameAsEmail = [
    {
      field: 'password',
      code: 'INVALID',
      message: 'must not be the account email or the part before @',
    },
  ];

  it.each([
    ['the email', EMAIL],
    ['the email in another case', 'Fixture.Policy.Owner@Example.COM'],
    ['the local part', LOCAL_PART],
    ['the local part in upper case', LOCAL_PART.toUpperCase()],
  ])('refuses %s for both audiences', (_case, password) => {
    expect(checkPasswordPolicy(password, 'customer', EMAIL)).toEqual(sameAsEmail);
    expect(checkPasswordPolicy(password, 'staff', EMAIL)).toEqual(sameAsEmail);
  });

  it('compares after NFC, so a decomposed accent matches the stored email', () => {
    const email = `caf${E_ACUTE}.fixture.owner@example.com`;
    const password = `CAFE${COMBINING_ACUTE}.FIXTURE.OWNER`;

    expect(matchesAccountEmail(password, email)).toBe(true);
    expect(checkPasswordPolicy(password, 'customer', email)).toEqual(sameAsEmail);
  });

  it('compares with the email in its stored form, trimmed and lower case', () => {
    expect(matchesAccountEmail(LOCAL_PART, `  ${EMAIL.toUpperCase()} `)).toBe(true);
  });

  it.each([
    ['the email with more around it', `${EMAIL}!`],
    ['the local part padded with spaces (never trimmed)', ` ${LOCAL_PART} `],
    ['the domain only', 'example.com-fixture'],
  ])('accepts %s', (_case, password) => {
    expect(checkPasswordPolicy(password, 'staff', EMAIL)).toEqual([]);
  });

  it('reports the length first when the local part is short', () => {
    expect(checkPasswordPolicy('an', 'customer', 'an@example.com')).toEqual(tooShort(10));
  });

  it('never repeats the password or the email in a message', () => {
    for (const error of checkPasswordPolicy(LOCAL_PART, 'staff', EMAIL)) {
      expect(error.message).not.toContain(LOCAL_PART);
      expect(error.message).not.toContain('example.com');
    }
  });
});

describe('normalizePassword and passwordLength', () => {
  it('normalises to NFC without trimming', () => {
    expect(normalizePassword(` e${COMBINING_ACUTE} `)).toBe(` ${E_ACUTE} `);
    expect(passwordLength(` e${COMBINING_ACUTE} `)).toBe(3);
  });
});

describe('passwordAudienceOf', () => {
  it('treats every staff role as staff', () => {
    expect(passwordAudienceOf('CUSTOMER')).toBe('customer');
    expect(passwordAudienceOf('STAFF')).toBe('staff');
    expect(passwordAudienceOf('MANAGER')).toBe('staff');
    expect(passwordAudienceOf('ADMIN')).toBe('staff');
  });
});
