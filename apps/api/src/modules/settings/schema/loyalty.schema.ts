import { IsDefined, IsInt, Max, Min, ValidateIf } from 'class-validator';

import { defineSettingSchema } from './setting-rules.js';

// `loyalty` (data-model `app_settings` and "Loyalty"; WA7; brief M22; mobile G134, G138). The
// owner has not given the rates, so every default is null (api-divergences D-106). The edit
// endpoint is `/admin/settings/loyalty` (phase 2); this is only its storage.

/** Bounds the documents do not state (api-divergences D-105). `vnd` is `integer >= 0`. */
export const LOYALTY_BOUNDS = {
  vndPerPoint: { min: 1, max: 2_147_483_647 },
  minRedeemPoints: { min: 1, max: 2_147_483_647 },
  expiryMonths: { min: 1, max: 120 },
} as const;

export interface LoyaltySetting {
  /** VND of subtotal (after the voucher discount) per point earned. */
  readonly earnVndPerPoint: number | null;
  /** VND value of one point when redeemed. */
  readonly redeemVndPerPoint: number | null;
  readonly minRedeemPoints: number | null;
  /** `null`: points never expire. */
  readonly expiryMonths: number | null;
}

/** `app_settings.value` of key `loyalty`, data-model names (brief M22). */
export interface LoyaltyStored {
  readonly earn_vnd_per_point: number | null;
  readonly redeem_vnd_per_point: number | null;
  readonly min_redeem_points: number | null;
  readonly expiry_months: number | null;
}

/** Every field is present; a nullable one takes `null`. */
export class LoyaltySettingDto implements LoyaltySetting {
  @ValidateIf((dto: LoyaltySettingDto) => dto.earnVndPerPoint !== null)
  @IsDefined()
  @IsInt()
  @Min(LOYALTY_BOUNDS.vndPerPoint.min)
  @Max(LOYALTY_BOUNDS.vndPerPoint.max)
  earnVndPerPoint!: number | null;

  @ValidateIf((dto: LoyaltySettingDto) => dto.redeemVndPerPoint !== null)
  @IsDefined()
  @IsInt()
  @Min(LOYALTY_BOUNDS.vndPerPoint.min)
  @Max(LOYALTY_BOUNDS.vndPerPoint.max)
  redeemVndPerPoint!: number | null;

  @ValidateIf((dto: LoyaltySettingDto) => dto.minRedeemPoints !== null)
  @IsDefined()
  @IsInt()
  @Min(LOYALTY_BOUNDS.minRedeemPoints.min)
  @Max(LOYALTY_BOUNDS.minRedeemPoints.max)
  minRedeemPoints!: number | null;

  @ValidateIf((dto: LoyaltySettingDto) => dto.expiryMonths !== null)
  @IsDefined()
  @IsInt()
  @Min(LOYALTY_BOUNDS.expiryMonths.min)
  @Max(LOYALTY_BOUNDS.expiryMonths.max)
  expiryMonths!: number | null;
}

export function toLoyaltyStored(value: LoyaltySetting): LoyaltyStored {
  return {
    earn_vnd_per_point: value.earnVndPerPoint,
    redeem_vnd_per_point: value.redeemVndPerPoint,
    min_redeem_points: value.minRedeemPoints,
    expiry_months: value.expiryMonths,
  };
}

export function fromLoyaltyStored(stored: LoyaltyStored): LoyaltySetting {
  return {
    earnVndPerPoint: stored.earn_vnd_per_point,
    redeemVndPerPoint: stored.redeem_vnd_per_point,
    minRedeemPoints: stored.min_redeem_points,
    expiryMonths: stored.expiry_months,
  };
}

export const loyaltySchema = defineSettingSchema<'loyalty', LoyaltySetting, LoyaltyStored>({
  key: 'loyalty',
  storageKey: 'loyalty',
  dto: LoyaltySettingDto,
  toStored: toLoyaltyStored,
  fromStored: fromLoyaltyStored,
});
