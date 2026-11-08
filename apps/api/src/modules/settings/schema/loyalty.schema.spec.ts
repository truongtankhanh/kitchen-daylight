import { describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../settings-defaults.js';
import { fromLoyaltyStored, loyaltySchema, toLoyaltyStored } from './loyalty.schema.js';
import type { LoyaltySetting } from './loyalty.schema.js';

const RATES: LoyaltySetting = {
  earnVndPerPoint: 10_000,
  redeemVndPerPoint: 1_000,
  minRedeemPoints: 10,
  expiryMonths: 12,
};

function errorsOf(raw: unknown): { field: string; code: string }[] {
  const result = loyaltySchema.parse(raw);
  return result.ok ? [] : result.errors.map(({ field, code }) => ({ field, code }));
}

describe('loyaltySchema', () => {
  it('accepts its own default: every rate null until the owner gives them', () => {
    expect(SETTING_DEFAULTS.loyalty).toEqual({
      earnVndPerPoint: null,
      redeemVndPerPoint: null,
      minRedeemPoints: null,
      expiryMonths: null,
    });
    expect(loyaltySchema.parse(SETTING_DEFAULTS.loyalty)).toEqual({
      ok: true,
      value: SETTING_DEFAULTS.loyalty,
    });
  });

  it('accepts rates, and null expiry for points that never expire', () => {
    expect(errorsOf(RATES)).toEqual([]);
    expect(errorsOf({ ...RATES, expiryMonths: null })).toEqual([]);
  });

  it('maps to the snake_case names of brief M22 and back', () => {
    expect(toLoyaltyStored(RATES)).toEqual({
      earn_vnd_per_point: 10_000,
      redeem_vnd_per_point: 1_000,
      min_redeem_points: 10,
      expiry_months: 12,
    });
    expect(fromLoyaltyStored(toLoyaltyStored(RATES))).toEqual(RATES);
  });

  it.each([
    ['earnVndPerPoint', 0, 'OUT_OF_RANGE'],
    ['redeemVndPerPoint', -1, 'OUT_OF_RANGE'],
    ['minRedeemPoints', 0, 'OUT_OF_RANGE'],
    ['expiryMonths', 121, 'OUT_OF_RANGE'],
    ['earnVndPerPoint', 1.5, 'INVALID'],
    ['minRedeemPoints', undefined, 'REQUIRED'],
  ])('reports %s = %s as %s', (field, value, code) => {
    expect(errorsOf({ ...RATES, [field]: value })).toEqual([{ field: `loyalty.${field}`, code }]);
  });
});
