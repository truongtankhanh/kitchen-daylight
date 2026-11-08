import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../settings-defaults.js';
import { fromPaymentStored, paymentSchema, toPaymentStored } from './payment.schema.js';
import type { PaymentSetting } from './payment.schema.js';

/** Fictional bank details (CLAUDE.md, "What is public-safe"). */
const FILLED: PaymentSetting = {
  bankName: 'Ngân hàng Mẫu',
  accountNumber: '0000000001',
  accountHolder: 'CONG TY MAU',
  transferNoteRule: 'Mã đơn hàng',
  bankCode: '000001',
  qrMediaId: '01930000-0000-7000-8000-0000000000a2',
};

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = paymentSchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

describe('paymentSchema', () => {
  it('accepts its own default: every field null, bank transfer off', () => {
    expect(SETTING_DEFAULTS.payment).toEqual({
      bankName: null,
      accountNumber: null,
      accountHolder: null,
      transferNoteRule: null,
      bankCode: null,
      qrMediaId: null,
    });
    expect(paymentSchema.parse(SETTING_DEFAULTS.payment)).toEqual({
      ok: true,
      value: SETTING_DEFAULTS.payment,
    });
  });

  it('accepts complete bank details', () => {
    expect(errorsOf(FILLED)).toEqual([]);
  });

  it('maps to snake_case names and back', () => {
    expect(toPaymentStored(FILLED)).toEqual({
      bank_name: 'Ngân hàng Mẫu',
      account_number: '0000000001',
      account_holder: 'CONG TY MAU',
      transfer_note_rule: 'Mã đơn hàng',
      bank_code: '000001',
      qr_media_id: '01930000-0000-7000-8000-0000000000a2',
    });
    expect(fromPaymentStored(toPaymentStored(FILLED))).toEqual(FILLED);
  });

  it.each([
    [
      'an account number with a space',
      { accountNumber: '0000 000001' },
      'accountNumber',
      'INVALID_FORMAT',
    ],
    [
      'an account number with a letter',
      { accountNumber: '00000A0001' },
      'accountNumber',
      'INVALID_FORMAT',
    ],
    ['an empty account number', { accountNumber: '' }, 'accountNumber', 'INVALID_FORMAT'],
    [
      'an account number of 31 digits',
      { accountNumber: '0'.repeat(31) },
      'accountNumber',
      'TOO_LONG',
    ],
    ['a bank code of 5 digits', { bankCode: '00001' }, 'bankCode', 'INVALID_FORMAT'],
    ['a bank code of 7 digits', { bankCode: '0000001' }, 'bankCode', 'INVALID_FORMAT'],
    ['a bank code with a letter', { bankCode: 'A00001' }, 'bankCode', 'INVALID_FORMAT'],
    ['a blank bank name', { bankName: ' ' }, 'bankName', 'REQUIRED'],
    ['a bank name of 101 characters', { bankName: 'a'.repeat(101) }, 'bankName', 'TOO_LONG'],
    [
      'an account holder of 101 characters',
      { accountHolder: 'a'.repeat(101) },
      'accountHolder',
      'TOO_LONG',
    ],
    ['a QR id that is not a uuid', { qrMediaId: 'qr.png' }, 'qrMediaId', 'INVALID'],
    ['a missing bank code', { bankCode: undefined }, 'bankCode', 'REQUIRED'],
  ])('reports %s', (_case, changes, field, code) => {
    expect(errorsOf({ ...FILLED, ...changes })).toEqual([{ field: `payment.${field}`, code }]);
  });

  it('never puts the rejected account number in an error', () => {
    const result = paymentSchema.parse({ ...FILLED, accountNumber: '1234 5678 9' });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('1234 5678 9');
  });
});
