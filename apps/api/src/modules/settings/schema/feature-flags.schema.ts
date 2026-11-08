import { IsBoolean, IsDefined } from 'class-validator';

import { defineSettingSchema } from './setting-rules.js';

// `feature_flags` (data-model `app_settings`; brief Z3; mobile G41).

export interface FeatureFlagsSetting {
  readonly ordering: boolean;
  readonly delivery: boolean;
  readonly reservations: boolean;
  readonly loyalty: boolean;
  readonly vouchers: boolean;
  readonly promotions: boolean;
  readonly charts: boolean;
  /** Off while e-invoices are deferred (WA17). */
  readonly einvoice: boolean;
}

/** `app_settings.value` of key `feature_flags`; every name is one word, the same in both. */
export type FeatureFlagsStored = FeatureFlagsSetting;

export class FeatureFlagsSettingDto implements FeatureFlagsSetting {
  @IsDefined()
  @IsBoolean()
  ordering!: boolean;

  @IsDefined()
  @IsBoolean()
  delivery!: boolean;

  @IsDefined()
  @IsBoolean()
  reservations!: boolean;

  @IsDefined()
  @IsBoolean()
  loyalty!: boolean;

  @IsDefined()
  @IsBoolean()
  vouchers!: boolean;

  @IsDefined()
  @IsBoolean()
  promotions!: boolean;

  @IsDefined()
  @IsBoolean()
  charts!: boolean;

  @IsDefined()
  @IsBoolean()
  einvoice!: boolean;
}

function flags(value: FeatureFlagsSetting): FeatureFlagsSetting {
  return {
    ordering: value.ordering,
    delivery: value.delivery,
    reservations: value.reservations,
    loyalty: value.loyalty,
    vouchers: value.vouchers,
    promotions: value.promotions,
    charts: value.charts,
    einvoice: value.einvoice,
  };
}

export const toFeatureFlagsStored: (value: FeatureFlagsSetting) => FeatureFlagsStored = flags;
export const fromFeatureFlagsStored: (stored: FeatureFlagsStored) => FeatureFlagsSetting = flags;

export const featureFlagsSchema = defineSettingSchema<
  'featureFlags',
  FeatureFlagsSetting,
  FeatureFlagsStored
>({
  key: 'featureFlags',
  storageKey: 'feature_flags',
  dto: FeatureFlagsSettingDto,
  toStored: toFeatureFlagsStored,
  fromStored: fromFeatureFlagsStored,
});
