import { describe, expect, it } from 'vitest';

import { PersonalDataError, assertNoPersonalData } from './personal-data-guard.js';

function refusedPath(payload: unknown, extraWords?: readonly string[]): string {
  try {
    assertNoPersonalData(payload, extraWords === undefined ? {} : { extraWords });
  } catch (error) {
    expect(error).toBeInstanceOf(PersonalDataError);
    return (error as PersonalDataError).path;
  }
  throw new Error('expected a PersonalDataError');
}

describe('assertNoPersonalData', () => {
  it('accepts a signal payload: ids, statuses, versions, counts and an actor { id, name }', () => {
    expect(() =>
      assertNoPersonalData({
        orderId: '0199a3c0-0000-7000-8000-000000000001',
        status: 'ACCEPTED',
        rowVersion: 3,
        keys: ['maintenance', 'minAppVersion'],
        actor: { id: '0199a3c0-0000-7000-8000-0000000000a1', name: 'Lan' },
        tableIds: ['0199a3c0-0000-7000-8000-0000000000d1'],
      }),
    ).not.toThrow();
  });

  it('accepts values that are not objects', () => {
    expect(() => assertNoPersonalData(null)).not.toThrow();
    expect(() => assertNoPersonalData('phone')).not.toThrow();
    expect(() => assertNoPersonalData(42)).not.toThrow();
  });

  it.each([
    ['email'],
    ['phone'],
    ['password'],
    ['token'],
    ['code'],
    ['address'],
    ['contact'],
    ['secret'],
  ])('refuses the key %s', (key) => {
    expect(refusedPath({ [key]: 'x' })).toBe(key);
  });

  it.each([
    ['EMAIL'],
    ['Phone'],
    ['customerPhone'],
    ['customer_phone'],
    ['contact-name'],
    ['deliveryAddress'],
    ['accessToken'],
    ['refreshTokens'],
    ['addresses'],
    ['TOTPSecret'],
    ['verificationCode'],
  ])('refuses %s whatever its case or position in the key', (key) => {
    expect(refusedPath({ [key]: 'x' })).toBe(key);
  });

  it('looks into nested objects and arrays, and reports the path only', () => {
    expect(refusedPath({ order: { customer: { phone: '+84901234567' } } })).toBe(
      'order.customer.phone',
    );
    expect(refusedPath({ lines: [{ itemId: 'a' }, { itemId: 'b', note: { email: 'x' } }] })).toBe(
      'lines[1].note.email',
    );
    expect(refusedPath([{ contact: 'x' }])).toBe('[0].contact');
  });

  it('never puts a value in the message', () => {
    try {
      assertNoPersonalData({ customer: { phone: '+84901234567' } });
    } catch (error) {
      expect((error as Error).message).not.toContain('+84901234567');
      return;
    }
    throw new Error('expected a PersonalDataError');
  });

  it('takes extra words for one caller', () => {
    expect(() => assertNoPersonalData({ note: 'x' })).not.toThrow();
    expect(refusedPath({ deliveryNote: 'x' }, ['NOTE'])).toBe('deliveryNote');
  });

  it('does not loop on a cycle', () => {
    const payload: Record<string, unknown> = { id: 'a' };
    payload['self'] = payload;
    expect(() => assertNoPersonalData(payload)).not.toThrow();
  });
});
