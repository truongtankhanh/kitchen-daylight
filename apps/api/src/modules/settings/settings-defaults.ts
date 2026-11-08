import type { SettingValues } from './schema/registry.js';
import type { SettingKey } from './schema/setting-rules.js';

/**
 * The value of a key that has no row yet (data-model `app_settings`, all values proposals until the
 * owner confirms them; WA14, WA16). The seed (A4-T5) writes these rows. Fictional placeholders only:
 * the restaurant's real data is supplied at deploy time, never committed.
 */
export const SETTING_DEFAULTS: { readonly [Key in SettingKey]: SettingValues[Key] } = {
  brand: {
    // Working name; the real name is not settled.
    name: 'Kitchen Daylight',
    logo: null,
    hotline: null,
    supportEmail: null,
    businessAddress: null,
    taxCode: null,
    receipt: {
      // Open item 8 R2: the owner confirms the title.
      title: 'HÓA ĐƠN BÁN HÀNG',
      footer: '',
      paperWidth: 80,
      showTaxCode: false,
    },
  },
  reports: {
    // A restaurant open past midnight (WA14); `00:00` gives calendar days.
    businessDayStartsAt: '04:00',
  },
  minAppVersion: {
    ios: '0.0.0',
    android: '0.0.0',
  },
  maintenance: {
    enabled: false,
    message: null,
    expectedBackAt: null,
    since: null,
  },
  featureFlags: {
    ordering: true,
    delivery: true,
    reservations: false,
    loyalty: false,
    vouchers: false,
    promotions: false,
    charts: false,
    einvoice: false,
  },
  // Bank transfer off until the owner supplies the details (mobile open question 9).
  payment: {
    bankName: null,
    accountNumber: null,
    accountHolder: null,
    transferNoteRule: null,
    bankCode: null,
    qrMediaId: null,
  },
  // WA16, brief L3, L4, A34, A42; mobile G32, G33, G70.
  ordering: {
    maxItemQuantity: 20,
    maxCartLines: 30,
    itemNoteMax: 200,
    scheduleMinLeadMinutes: 30,
    scheduleMaxDaysAhead: 3,
    reviewWindowDays: 7,
    autoCancelUnacceptedMinutes: null,
    boardThresholds: {
      accept: { warn: 5, late: 10 },
      ready: { warn: 15, late: 25 },
    },
    boardRefetchSeconds: 15,
    readyUnservedWarnMinutes: 5,
    readyUnservedLateMinutes: 10,
    callHintMinutes: 10,
    listMaxRangeDays: 92,
  },
  // The owner has not given the rates (api-divergences D-106).
  loyalty: {
    earnVndPerPoint: null,
    redeemVndPerPoint: null,
    minRedeemPoints: null,
    expiryMonths: null,
  },
};
