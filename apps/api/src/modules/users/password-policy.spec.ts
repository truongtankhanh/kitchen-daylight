import { describe, expect, it } from 'vitest';

import {
  checkPasswordPolicy,
  normalizePassword,
  passwordAudienceOf,
  passwordLength,
} from './password-policy.js';

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
    expect(checkPasswordPolicy(ascii(length), 'customer')).toEqual(customer);
    expect(checkPasswordPolicy(ascii(length), 'staff')).toEqual(staff);
  });

  it('counts code points, not UTF-16 units', () => {
    expect(emoji(10)).toHaveLength(20);
    expect(checkPasswordPolicy(emoji(9), 'customer')).toEqual(tooShort(10));
    expect(checkPasswordPolicy(emoji(10), 'customer')).toEqual([]);
    expect(checkPasswordPolicy(emoji(128), 'staff')).toEqual([]);
    expect(checkPasswordPolicy(emoji(129), 'staff')).toEqual(tooLong);
  });

  it('counts after NFC, so a decomposed accent is one character', () => {
    expect(decomposed(10)).toHaveLength(20);
    expect(checkPasswordPolicy(decomposed(9), 'customer')).toEqual(tooShort(10));
    expect(checkPasswordPolicy(decomposed(10), 'customer')).toEqual([]);
    expect(checkPasswordPolicy(decomposed(128), 'customer')).toEqual([]);
    expect(checkPasswordPolicy(decomposed(129), 'customer')).toEqual(tooLong);
  });

  it('has no composition rule and keeps whitespace', () => {
    expect(checkPasswordPolicy(' '.repeat(10), 'customer')).toEqual([]);
    expect(checkPasswordPolicy('mật khẩu dài', 'staff')).toEqual([]);
  });

  it('never repeats the password in a message', () => {
    const input = 'fixture-short';
    for (const error of checkPasswordPolicy(input, 'staff')) {
      expect(error.message).not.toContain(input);
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
