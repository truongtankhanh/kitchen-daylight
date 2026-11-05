import { describe, expect, it } from 'vitest';

import { sanitizeDiff } from './sanitize-diff.js';

// Fictional values only (CLAUDE.md, "What is public-safe").
const PHONE = '+84901234567';
const EMAIL = 'guest@example.com';
const ACCOUNT = '0123 4567 8901';

describe('sanitizeDiff', () => {
  it('returns a diff with only safe members unchanged', () => {
    const diff = {
      status: { from: 'PUBLISHED', to: 'HIDDEN' },
      note: 'Spam',
      basePrice: { from: 45000, to: 50000 },
      branchCode: 'BT',
      voucherCode: 'WELCOME10',
      tags: [{ tagId: 't1', verified: true }],
      appliedTo: ['r1', 'r2'],
      location: { from: { lat: 10.77, lng: 106.69 }, to: { lat: 10.78, lng: 106.7 } },
      phoneLast4: '4567',
      customer_phone_last4: '4567',
      nothing: null,
    };

    expect(sanitizeDiff(diff)).toEqual(diff);
  });

  it.each([
    'password',
    'Password',
    'PASSWORD',
    'passwordHash',
    'password_hash',
    'currentPassword',
    'current_password',
    'newPassword',
    'new-password',
    'code',
    'Code',
    'CODE',
    'codes',
    'otp',
    'otpCode',
    'OTP',
    'token',
    'tokens',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'idToken',
    'id_token',
    'secret',
    'totpSecret',
    'totp_secret',
    'secretEncrypted',
    'recoveryCodes',
    'recovery_codes',
    'totpCode',
    'phone',
    'customerPhone',
    'contact_phone',
    'Phone',
    'email',
    'Email',
    'emailAddress',
    'emails',
    'address',
    'addressLine',
    'delivery_address_text',
    'addresses',
    'contact',
    'contactName',
    'contact_name',
  ])('strips the key %s', (key) => {
    const result = sanitizeDiff({ [key]: 'x', kept: 1 });

    expect(result).toEqual({ kept: 1 });
  });

  it('strips a whole { from, to } pair under a refused key', () => {
    expect(
      sanitizeDiff({
        contactPhone: { from: PHONE, to: '+84907654321' },
        partySize: { from: 2, to: 4 },
      }),
    ).toEqual({ partySize: { from: 2, to: 4 } });
  });

  it('strips refused keys in nested objects', () => {
    const result = sanitizeDiff({
      before: { displayName: 'Lan', email: EMAIL, auth: { passwordHash: 'h', role: 'STAFF' } },
      after: { displayName: 'Lan', email: EMAIL, auth: { passwordHash: 'h2', role: 'MANAGER' } },
    });

    expect(result).toEqual({
      before: { displayName: 'Lan', auth: { role: 'STAFF' } },
      after: { displayName: 'Lan', auth: { role: 'MANAGER' } },
    });
  });

  it('strips refused keys inside arrays and keeps primitive items', () => {
    const result = sanitizeDiff({
      items: [
        { id: 'a', refreshToken: 'r' },
        { id: 'b', customer: { phone: PHONE, name: 'An' } },
      ],
      labels: ['one', 'two'],
      matrix: [[{ secret: 's', ok: true }]],
    });

    expect(result).toEqual({
      items: [{ id: 'a' }, { id: 'b', customer: { name: 'An' } }],
      labels: ['one', 'two'],
      matrix: [[{ ok: true }]],
    });
  });

  it.each([
    ['accountNumber', 'accountNumberLast5'],
    ['AccountNumber', 'AccountNumberLast5'],
    ['bankAccountNumber', 'bankAccountNumberLast5'],
    ['account_number', 'account_number_last5'],
  ])('reduces %s to %s with the last 5 digits', (key, reduced) => {
    expect(sanitizeDiff({ [key]: ACCOUNT, bankName: 'Example Bank' })).toEqual({
      [reduced]: '78901',
      bankName: 'Example Bank',
    });
  });

  it('reduces an account number inside a { from, to } pair and nested settings', () => {
    const result = sanitizeDiff({
      payment: {
        accountNumber: { from: '0123456789012', to: 9876543210 },
        accountName: 'KITCHEN DAYLIGHT',
      },
    });

    expect(result).toEqual({
      payment: {
        accountNumberLast5: { from: '89012', to: '43210' },
        accountName: 'KITCHEN DAYLIGHT',
      },
    });
    expect(JSON.stringify(result)).not.toContain('0123456789012');
  });

  it('turns an account number without digits or of another type into null', () => {
    expect(sanitizeDiff({ accountNumber: null, account_number: true })).toEqual({
      accountNumberLast5: null,
      account_number_last5: null,
    });
    expect(sanitizeDiff({ accountNumber: 'n/a' })).toEqual({ accountNumberLast5: null });
  });

  it('never leaves a refused value anywhere in the serialized result', () => {
    const result = sanitizeDiff({
      a: { b: [{ c: { email: EMAIL, phone: PHONE, token: 't0ken', accountNumber: ACCOUNT } }] },
    });
    const json = JSON.stringify(result);

    expect(json).not.toContain(EMAIL);
    expect(json).not.toContain(PHONE);
    expect(json).not.toContain('t0ken');
    expect(json).not.toContain(ACCOUNT);
  });

  it('keeps dates and does not change its input', () => {
    const at = new Date('2026-11-05T03:00:00.000Z');
    const input = { at, nested: { password: 'p', keep: 1 } };

    const result = sanitizeDiff(input);

    expect(result).toEqual({ at, nested: { keep: 1 } });
    expect(input).toEqual({ at, nested: { password: 'p', keep: 1 } });
  });

  it('accepts a shared reference but refuses a cycle', () => {
    const shared = { value: 1 };
    expect(sanitizeDiff({ left: shared, right: shared })).toEqual({
      left: { value: 1 },
      right: { value: 1 },
    });

    const cyclic: Record<string, unknown> = { value: 1 };
    cyclic['self'] = cyclic;
    expect(() => sanitizeDiff(cyclic)).toThrow(/cycle/);
  });
});
