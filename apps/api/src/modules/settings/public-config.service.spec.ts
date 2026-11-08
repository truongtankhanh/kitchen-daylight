import { describe, expect, it } from 'vitest';

import { buildPublicConfig, isBankTransferComplete } from './public-config.service.js';
import type { PublicConfigInput } from './public-config.service.js';
import type { SettingValues } from './schema/registry.js';
import { SETTING_DEFAULTS } from './settings-defaults.js';

/** Fictional bank details. */
const PAYMENT: SettingValues['payment'] = {
  bankName: 'Ngân hàng Mẫu',
  accountNumber: '0000000012345',
  accountHolder: 'CONG TY MAU',
  transferNoteRule: 'Mã đơn hàng',
  bankCode: '000001',
  qrMediaId: null,
};

function input(overrides: Partial<PublicConfigInput> = {}): PublicConfigInput {
  return {
    brand: { ...SETTING_DEFAULTS.brand, hotline: '+84281234567', taxCode: '0000000001' },
    minAppVersion: SETTING_DEFAULTS.minAppVersion,
    maintenance: SETTING_DEFAULTS.maintenance,
    featureFlags: SETTING_DEFAULTS.featureFlags,
    ordering: SETTING_DEFAULTS.ordering,
    payment: PAYMENT,
    loyalty: SETTING_DEFAULTS.loyalty,
    ...overrides,
  };
}

describe('isBankTransferComplete', () => {
  it('is true when bank name, account number and holder are all filled', () => {
    expect(isBankTransferComplete(PAYMENT)).toBe(true);
    expect(isBankTransferComplete({ ...PAYMENT, bankCode: null, transferNoteRule: null })).toBe(
      true,
    );
  });

  it.each([
    ['the default (all null)', SETTING_DEFAULTS.payment],
    ['no bank name', { ...PAYMENT, bankName: null }],
    ['no account number', { ...PAYMENT, accountNumber: null }],
    ['a blank holder', { ...PAYMENT, accountHolder: ' ' }],
  ])('is false with %s', (_case, payment) => {
    expect(isBankTransferComplete(payment)).toBe(false);
  });
});

describe('buildPublicConfig', () => {
  it('assembles the public shape of the outline', () => {
    expect(buildPublicConfig(input())).toEqual({
      brand: { name: 'Kitchen Daylight', logoUrl: null, hotline: '+84281234567' },
      minAppVersion: { ios: '0.0.0', android: '0.0.0' },
      maintenance: { enabled: false, message: null, expectedBackAt: null, since: null },
      featureFlags: { ordering: true, delivery: true, reservations: false, loyalty: false },
      ordering: {
        maxItemQuantity: 20,
        maxCartLines: 30,
        itemNoteMax: 200,
        scheduleMinLeadMinutes: 30,
        scheduleMaxDaysAhead: 3,
        callHintMinutes: 10,
        reviewWindowDays: 7,
      },
      payment: { bankTransferEnabled: true },
      loyalty: {
        earnVndPerPoint: null,
        redeemVndPerPoint: null,
        minRedeemPoints: null,
        expiryMonths: null,
      },
      cdnBaseUrl: null,
      mapStyleUrl: null,
      attributions: [],
    });
  });

  it('never carries a bank detail, the tax code or an admin-only setting', () => {
    const text = JSON.stringify(buildPublicConfig(input()));

    for (const secret of [
      'Ngân hàng Mẫu',
      '0000000012345',
      'CONG TY MAU',
      '000001',
      '0000000001',
      'taxCode',
      'receipt',
      'boardThresholds',
      'autoCancelUnacceptedMinutes',
      'einvoice',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
