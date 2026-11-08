import type { SettingStorageKey } from '../entities/app-setting.entity.js';
import { brandSchema } from './brand.schema.js';
import type { BrandSetting, BrandStored } from './brand.schema.js';
import { featureFlagsSchema } from './feature-flags.schema.js';
import type { FeatureFlagsSetting, FeatureFlagsStored } from './feature-flags.schema.js';
import { loyaltySchema } from './loyalty.schema.js';
import type { LoyaltySetting, LoyaltyStored } from './loyalty.schema.js';
import { maintenanceSchema } from './maintenance.schema.js';
import type { MaintenanceSetting, MaintenanceStored } from './maintenance.schema.js';
import { minAppVersionSchema } from './min-app-version.schema.js';
import type { MinAppVersionSetting, MinAppVersionStored } from './min-app-version.schema.js';
import { orderingSchema } from './ordering.schema.js';
import type { OrderingSetting, OrderingStored } from './ordering.schema.js';
import { paymentSchema } from './payment.schema.js';
import type { PaymentSetting, PaymentStored } from './payment.schema.js';
import { reportsSchema } from './reports.schema.js';
import type { ReportsSetting, ReportsStored } from './reports.schema.js';
import type { SettingKey, SettingSchema } from './setting-rules.js';

/** The camelCase API value of each key. */
export interface SettingValues {
  brand: BrandSetting;
  reports: ReportsSetting;
  minAppVersion: MinAppVersionSetting;
  maintenance: MaintenanceSetting;
  featureFlags: FeatureFlagsSetting;
  payment: PaymentSetting;
  ordering: OrderingSetting;
  loyalty: LoyaltySetting;
}

/** The snake_case object of each key in `app_settings.value`. */
export interface SettingStoredValues {
  brand: BrandStored;
  reports: ReportsStored;
  minAppVersion: MinAppVersionStored;
  maintenance: MaintenanceStored;
  featureFlags: FeatureFlagsStored;
  payment: PaymentStored;
  ordering: OrderingStored;
  loyalty: LoyaltyStored;
}

export type AnySettingSchema<Key extends SettingKey = SettingKey> = SettingSchema<
  Key,
  SettingValues[Key],
  SettingStoredValues[Key]
>;

/** One schema per key. */
export const SETTING_SCHEMAS: { readonly [Key in SettingKey]: AnySettingSchema<Key> } = {
  brand: brandSchema,
  reports: reportsSchema,
  minAppVersion: minAppVersionSchema,
  maintenance: maintenanceSchema,
  featureFlags: featureFlagsSchema,
  payment: paymentSchema,
  ordering: orderingSchema,
  loyalty: loyaltySchema,
};

/** The schema of a storage key, for a row read back from `app_settings`. */
export function schemaOfStorageKey(storageKey: SettingStorageKey): AnySettingSchema {
  const schema = Object.values(SETTING_SCHEMAS).find((entry) => entry.storageKey === storageKey);
  if (schema === undefined) {
    throw new Error('Unknown app_settings key.');
  }
  return schema;
}
