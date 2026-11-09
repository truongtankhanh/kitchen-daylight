import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type {
  AdminBranchDetailView,
  AdminBranchLocationView,
  AdminBranchPage,
  AdminBranchRowView,
} from '../branches.service.js';
import { BRANCH_STATUSES } from '../entities/branch.entity.js';
import type { BranchDescription, BranchStatus } from '../entities/branch.entity.js';
import { TodayHoursSessionDto } from './branch-hours.dto.js';

/** WGS 84 degrees, read from `geography(Point, 4326)`. */
@ApiSchema({ name: 'AdminBranchLocation' })
export class AdminBranchLocationDto implements AdminBranchLocationView {
  @ApiProperty({ minimum: -90, maximum: 90 })
  lat!: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  lng!: number;
}

/**
 * `AdminBranchRow` (api-outline "Response shapes", brief C2): the branch fields plus the derived
 * figures of the list. Never `deleted_at`, the rating counters or another internal column.
 */
@ApiSchema({ name: 'AdminBranchRow' })
export class AdminBranchRowDto implements AdminBranchRowView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  code!: string;

  slug!: string;

  name!: string;

  addressLine!: string;

  provinceCode!: string;

  @ApiProperty({ type: String, nullable: true })
  wardCode!: string | null;

  @ApiProperty({ type: AdminBranchLocationDto })
  location!: AdminBranchLocationDto;

  /** E.164. */
  phone!: string;

  @ApiProperty({ enum: BRANCH_STATUSES })
  status!: BranchStatus;

  acceptsPickup!: boolean;

  acceptsDelivery!: boolean;

  acceptsReservations!: boolean;

  @ApiProperty({ type: 'integer' })
  sortOrder!: number;

  /** Rows of `staff_branches` for the branch. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  staffCount!: number;

  /** Plain average of published reviews, one decimal; `null` without reviews (open item 7). */
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 })
  ratingAverage!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  reviewCount!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  activeZoneCount!: number;

  /** True once an order exists: `code` can no longer change (brief C6). */
  codeLocked!: boolean;

  /** Orders placed today (Vietnam business day). */
  @ApiProperty({ type: 'integer', minimum: 0 })
  ordersToday!: number;

  /** Orders not yet in a final state. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  activeOrders!: number;

  /**
   * Today's effective store sessions (Vietnam date), special days applied; `[]` when closed today
   * (a proposal, api-divergences D-139).
   */
  @ApiProperty({ type: TodayHoursSessionDto, isArray: true })
  todayHours!: TodayHoursSessionDto[];
}

/**
 * `GET /api/v1/admin/branches/{id}`, also the body of `POST` and `PATCH`: the row plus what the
 * edit form needs (services, reservation rules, contact, amenities) and `rowVersion`.
 */
@ApiSchema({ name: 'AdminBranchDetail' })
export class AdminBranchDetailDto extends AdminBranchRowDto implements AdminBranchDetailView {
  @ApiProperty({ type: 'integer', minimum: 1 })
  rowVersion!: number;

  /** Translations with a `vi` key; `null` when none. */
  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: { vi: { type: 'string' } },
    additionalProperties: { type: 'string' },
  })
  description!: BranchDescription | null;

  @ApiProperty({ type: String, nullable: true })
  websiteUrl!: string | null;

  /** Shown by the customer app on a `TEMPORARILY_CLOSED` branch (mobile G11). */
  @ApiProperty({ type: String, nullable: true })
  pauseMessage!: string | null;

  @ApiProperty({ type: 'integer', minimum: 0 })
  defaultPrepMinutes!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  orderCutoffMinutes!: number;

  @ApiProperty({ type: 'integer' })
  reservationDurationMinutes!: number;

  @ApiProperty({ type: 'integer' })
  reservationSlotStepMinutes!: number;

  @ApiProperty({ type: 'integer' })
  reservationMaxParty!: number;

  @ApiProperty({ type: 'integer' })
  reservationLeadMinutes!: number;

  @ApiProperty({ type: 'integer' })
  reservationMaxDaysAhead!: number;

  @ApiProperty({ type: String, format: 'uuid', isArray: true })
  amenityIds!: string[];

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** `GET /api/v1/admin/branches`: an offset page of rows. */
@ApiSchema({ name: 'AdminBranchPage' })
export class AdminBranchPageDto implements AdminBranchPage {
  @ApiProperty({ type: AdminBranchRowDto, isArray: true })
  items!: AdminBranchRowDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}
