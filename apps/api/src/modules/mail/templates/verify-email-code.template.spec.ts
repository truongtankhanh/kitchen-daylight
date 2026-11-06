import { randomInt } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { renderVerifyEmailCode } from './verify-email-code.template.js';

// A throw-away code for each run, above 100000 so it never matches the minutes figure.
const CODE = String(randomInt(100_000, 1_000_000));

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('renderVerifyEmailCode', () => {
  it('renders the VERIFY_EMAIL_CODE key as plain Vietnamese text', () => {
    const mail = renderVerifyEmailCode({ code: CODE, expiresInMinutes: 10 });

    expect(mail.templateKey).toBe('VERIFY_EMAIL_CODE');
    expect(mail.subject).toBe('Mã xác minh email của bạn');
    expect(mail.text).toContain(`Mã xác minh email của bạn là: ${CODE}`);
    expect(mail.text).toContain('10 phút');
    expect(Object.keys(mail).sort()).toEqual(['subject', 'templateKey', 'text']);
    expect(mail.text).not.toMatch(/<[a-z][^>]*>/i);
  });

  it('puts the code once in the body and never in the subject', () => {
    const mail = renderVerifyEmailCode({ code: CODE, expiresInMinutes: 10 });

    expect(occurrences(mail.text, CODE)).toBe(1);
    expect(mail.subject).not.toContain(CODE);
  });

  it('is pure and frozen', () => {
    const first = renderVerifyEmailCode({ code: CODE, expiresInMinutes: 15 });

    expect(renderVerifyEmailCode({ code: CODE, expiresInMinutes: 15 })).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it.each(['12345', '1234567', 'abcdef', ' 123456', '12 456'])(
    'rejects the code %j without echoing it',
    (code) => {
      expect(() => renderVerifyEmailCode({ code, expiresInMinutes: 10 })).toThrow(
        'VERIFY_EMAIL_CODE: the code must be 6 digits',
      );
    },
  );

  it.each([0, -1, 1.5, Number.NaN])('rejects expiresInMinutes=%s', (expiresInMinutes) => {
    expect(() => renderVerifyEmailCode({ code: CODE, expiresInMinutes })).toThrow(
      'VERIFY_EMAIL_CODE: expiresInMinutes must be a positive integer',
    );
  });
});
