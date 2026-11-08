import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type { PublicConfigView } from '../public-config.service.js';
import {
  LoyaltyValueDto,
  MaintenanceValueDto,
  MinAppVersionValueDto,
} from './setting-values.dto.js';

type BrandView = PublicConfigView['brand'];
type FeatureFlagsView = PublicConfigView['featureFlags'];
type OrderingView = PublicConfigView['ordering'];
type PaymentView = PublicConfigView['payment'];

@ApiSchema({ name: 'PublicBrand' })
export class PublicBrandDto implements BrandView {
  /** The brand name (a working name until the owner settles it). */
  name!: string;

  /** `null` until media URLs exist (A6). */
  @ApiProperty({ type: String, format: 'uri', nullable: true })
  logoUrl!: string | null;

  /** E.164; a landline is allowed. */
  @ApiProperty({ type: String, nullable: true })
  hotline!: string | null;
}

@ApiSchema({ name: 'PublicFeatureFlags' })
export class PublicFeatureFlagsDto implements FeatureFlagsView {
  ordering!: boolean;

  delivery!: boolean;

  reservations!: boolean;

  loyalty!: boolean;
}

@ApiSchema({ name: 'PublicOrdering' })
export class PublicOrderingDto implements OrderingView {
  /** Quantity limit of one cart line, at most 99. */
  maxItemQuantity!: number;

  /** Default 30 (mobile G33). */
  maxCartLines!: number;

  /** Length limit of an item note (mobile G32). */
  itemNoteMax!: number;

  scheduleMinLeadMinutes!: number;

  scheduleMaxDaysAhead!: number;

  /** Minutes without acceptance before the app suggests calling the branch (mobile G70). */
  callHintMinutes!: number;

  reviewWindowDays!: number;
}

@ApiSchema({ name: 'PublicPayment' })
export class PublicPaymentDto implements PaymentView {
  /** True only when the bank transfer details are complete; the details are never public. */
  bankTransferEnabled!: boolean;
}

/**
 * `GET /meta/config` (api-outline Public table): what the customer app needs before sign-in, the
 * forced-update and maintenance screens included. No bank detail and no admin-only setting.
 */
@ApiSchema({ name: 'PublicConfig' })
export class PublicConfigDto implements PublicConfigView {
  brand!: PublicBrandDto;

  /** `x.y.z` per platform; the server also compares it with `X-App-Version` (brief L12). */
  minAppVersion!: MinAppVersionValueDto;

  maintenance!: MaintenanceValueDto;

  featureFlags!: PublicFeatureFlagsDto;

  ordering!: PublicOrderingDto;

  payment!: PublicPaymentDto;

  /** Rates for the cart preview (mobile G134); `null` until the owner gives them. */
  loyalty!: LoyaltyValueDto;

  /** `null` until the CDN rule is decided (decision 0009, A6-T1). */
  @ApiProperty({ type: String, format: 'uri', nullable: true })
  cdnBaseUrl!: string | null;

  /** `null` until the map tile source is decided (ADR-0008 open item 1). */
  @ApiProperty({ type: String, format: 'uri', nullable: true })
  mapStyleUrl!: string | null;

  /** Attribution lines of the map and data sources; empty for now. */
  @ApiProperty({ type: String, isArray: true })
  attributions!: string[];
}
