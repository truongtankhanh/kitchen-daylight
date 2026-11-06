import { describe, expect, it } from 'vitest';

import { normalizeVietnamMobile, VIETNAM_PHONE_INPUT_MAX_LENGTH } from './vietnam-phone.js';

// Fictional numbers only: valid prefixes with placeholder digits.
describe('normalizeVietnamMobile', () => {
  it.each([
    ['0901234567', '+84901234567'],
    ['0351234567', '+84351234567'],
    ['0561234567', '+84561234567'],
    ['0761234567', '+84761234567'],
    ['0861234567', '+84861234567'],
  ])('reads the national form %s', (input, expected) => {
    expect(normalizeVietnamMobile(input)).toBe(expected);
  });

  it.each([
    ['+84901234567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['+84 90 123 4567', '+84901234567'],
  ])('reads the international form %s', (input, expected) => {
    expect(normalizeVietnamMobile(input)).toBe(expected);
  });

  it.each([
    ['090 123 4567', '+84901234567'],
    ['090-123-4567', '+84901234567'],
    ['090.123.4567', '+84901234567'],
    [' 0901234567 ', '+84901234567'],
    ['+84-90-123-4567', '+84901234567'],
  ])('removes spaces, dashes and dots in %s', (input, expected) => {
    expect(normalizeVietnamMobile(input)).toBe(expected);
  });

  it.each([
    ['a landline (02x)', '02812345678'],
    ['a landline in international form', '+842812345678'],
    ['a prefix that is not mobile (01)', '0121234567'],
    ['the trunk zero after +84', '+840901234567'],
    ['the 0084 prefix', '0084901234567'],
    ['too few digits', '090123456'],
    ['too many digits', '09012345678'],
    ['a foreign number', '+12025550123'],
    ['letters', '09012345ab'],
    ['parentheses', '(090) 123 4567'],
    ['an empty string', ''],
    ['separators only', ' - . '],
  ])('refuses %s', (_case, input) => {
    expect(normalizeVietnamMobile(input)).toBeNull();
  });

  it('refuses an input longer than the bound without matching it', () => {
    const padded = `0901234567${' '.repeat(VIETNAM_PHONE_INPUT_MAX_LENGTH)}`;
    expect(normalizeVietnamMobile(padded)).toBeNull();
  });

  it('always returns E.164 (+ then at most 15 digits, no leading zero)', () => {
    expect(normalizeVietnamMobile('0901234567')).toMatch(/^\+[1-9][0-9]{1,14}$/);
  });
});
