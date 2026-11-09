import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type { BrandSetting, ReceiptPaperWidth, ReceiptSetting } from '../schema/brand.schema.js';
import { RECEIPT_PAPER_WIDTHS } from '../schema/brand.schema.js';
import type { FeatureFlagsSetting } from '../schema/feature-flags.schema.js';
import type { LoyaltySetting } from '../schema/loyalty.schema.js';
import type { MaintenanceSetting } from '../schema/maintenance.schema.js';
import type { MinAppVersionSetting } from '../schema/min-app-version.schema.js';
import type { BoardThresholds, OrderingSetting, ThresholdPair } from '../schema/ordering.schema.js';
import type { PaymentSetting } from '../schema/payment.schema.js';
import type { ReportsSetting } from '../schema/reports.schema.js';

// The OpenAPI shapes of the eight settings values (camelCase, A4-T1). The rules live in
// `schema/*.schema.ts`, which the Swagger plugin does not read; each class implements the value
// type of its key, so a field added there fails the build until it is added here.

@ApiSchema({ name: 'SettingThresholdPair' })
export class ThresholdPairValueDto implements ThresholdPair {
  /** Minutes; below `late`. */
  warn!: number;

  /** Minutes. */
  late!: number;
}

@ApiSchema({ name: 'SettingBoardThresholds' })
export class BoardThresholdsValueDto implements BoardThresholds {
  /** From placed until accepted. */
  accept!: ThresholdPairValueDto;

  /** From preparing until ready (brief L4). */
  ready!: ThresholdPairValueDto;
}

@ApiSchema({ name: 'OrderingSetting' })
export class OrderingValueDto implements OrderingSetting {
  /** 1 to 99 (the `order_items.quantity` CHECK). */
  maxItemQuantity!: number;

  maxCartLines!: number;

  /** 1 to 200 (the `order_items.note` CHECK). */
  itemNoteMax!: number;

  scheduleMinLeadMinutes!: number;

  scheduleMaxDaysAhead!: number;

  reviewWindowDays!: number;

  /** `null`: off. Otherwise above `boardThresholds.accept.late`. */
  @ApiProperty({ type: Number, nullable: true })
  autoCancelUnacceptedMinutes!: number | null;

  boardThresholds!: BoardThresholdsValueDto;

  boardRefetchSeconds!: number;

  /** Below `readyUnservedLateMinutes`. */
  readyUnservedWarnMinutes!: number;

  readyUnservedLateMinutes!: number;

  callHintMinutes!: number;

  listMaxRangeDays!: number;
}

@ApiSchema({ name: 'ReceiptSetting' })
export class ReceiptValueDto implements ReceiptSetting {
  /** At most 40 characters. */
  title!: string;

  /** At most 200 characters and 4 lines; may be empty. */
  footer!: string;

  @ApiProperty({ enum: RECEIPT_PAPER_WIDTHS, type: Number })
  paperWidth!: ReceiptPaperWidth;

  showTaxCode!: boolean;
}

@ApiSchema({ name: 'BrandSetting' })
export class BrandValueDto implements BrandSetting {
  name!: string;

  /** A `media` id (brief L5). */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  logo!: string | null;

  /** E.164; a landline is allowed. */
  @ApiProperty({ type: String, nullable: true, example: '+842800000001' })
  hotline!: string | null;

  @ApiProperty({ type: String, format: 'email', nullable: true })
  supportEmail!: string | null;

  @ApiProperty({ type: String, nullable: true })
  businessAddress!: string | null;

  /** 10 or 13 digits. */
  @ApiProperty({ type: String, nullable: true })
  taxCode!: string | null;

  receipt!: ReceiptValueDto;
}

@ApiSchema({ name: 'ReportsSetting' })
export class ReportsValueDto implements ReportsSetting {
  /** `HH:mm`, Vietnam time. */
  @ApiProperty({ example: '04:00' })
  businessDayStartsAt!: string;
}

@ApiSchema({ name: 'MinAppVersionSetting' })
export class MinAppVersionValueDto implements MinAppVersionSetting {
  /** `x.y.z`. */
  @ApiProperty({ example: '1.0.0' })
  ios!: string;

  /** `x.y.z`. */
  @ApiProperty({ example: '1.0.0' })
  android!: string;
}

@ApiSchema({ name: 'MaintenanceSetting' })
export class MaintenanceValueDto implements MaintenanceSetting {
  enabled!: boolean;

  @ApiProperty({ type: String, nullable: true })
  message!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expectedBackAt!: string | null;

  /**
   * When maintenance began. Set by the server: stamped when `enabled` turns on, kept while it stays
   * on, `null` when it is off; a value sent in `PUT /admin/app-settings` is ignored.
   */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  since!: string | null;
}

@ApiSchema({ name: 'FeatureFlagsSetting' })
export class FeatureFlagsValueDto implements FeatureFlagsSetting {
  ordering!: boolean;

  delivery!: boolean;

  reservations!: boolean;

  loyalty!: boolean;

  vouchers!: boolean;

  promotions!: boolean;

  charts!: boolean;

  /** Off while e-invoices are deferred. */
  einvoice!: boolean;
}

@ApiSchema({ name: 'PaymentSetting' })
export class PaymentValueDto implements PaymentSetting {
  @ApiProperty({ type: String, nullable: true })
  bankName!: string | null;

  /** Digits only, one continuous string. */
  @ApiProperty({ type: String, nullable: true })
  accountNumber!: string | null;

  @ApiProperty({ type: String, nullable: true })
  accountHolder!: string | null;

  @ApiProperty({ type: String, nullable: true })
  transferNoteRule!: string | null;

  /** 6 digits. */
  @ApiProperty({ type: String, nullable: true })
  bankCode!: string | null;

  /** A `media` id. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  qrMediaId!: string | null;
}

@ApiSchema({ name: 'LoyaltySetting' })
export class LoyaltyValueDto implements LoyaltySetting {
  @ApiProperty({ type: Number, nullable: true })
  earnVndPerPoint!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  redeemVndPerPoint!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  minRedeemPoints!: number | null;

  /** `null`: points never expire. */
  @ApiProperty({ type: Number, nullable: true })
  expiryMonths!: number | null;
}

/** The value class of each key, for `oneOf` schemas. */
export const SETTING_VALUE_DTOS = [
  BrandValueDto,
  ReportsValueDto,
  MinAppVersionValueDto,
  MaintenanceValueDto,
  FeatureFlagsValueDto,
  PaymentValueDto,
  OrderingValueDto,
  LoyaltyValueDto,
] as const;
