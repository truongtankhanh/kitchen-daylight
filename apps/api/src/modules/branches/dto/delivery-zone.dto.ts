import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import type {
  AdminDeliveryZoneListView,
  AdminDeliveryZoneView,
  DeliveryZoneCheckView,
} from '../delivery-zones.service.js';
import { BranchLocationInputDto } from './admin-branch-input.dto.js';
import { ROW_VERSION_MAX } from './admin-branches-query.dto.js';

// Limits of `delivery_zones` (migration 0013 CHECKs, data-model `delivery_zones` row, brief C19,
// C20). The data model gives only the lower bounds; the upper bounds are api-divergences D-141.

/** `name`: trimmed, 1 to 100 characters (the bound of a branch name; D-141). */
export const ZONE_NAME_MAX_LENGTH = 100;
/** `radius_m > 0`; at most 100 km of straight-line distance (D-141). */
export const ZONE_RADIUS_M = Object.freeze({ min: 1, max: 100_000 });
/** The `vnd` domain: whole VND, 0 to the PostgreSQL `integer` maximum. */
export const ZONE_VND_MAX = 2_147_483_647;
/** `eta_minutes > 0`; at most one day (D-141). */
export const ZONE_ETA_MINUTES = Object.freeze({ min: 1, max: 1440 });

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Optional, but never `null`: `@IsOptional()` lets `null` through, which a `NOT NULL` column must
 * not receive (as in `admin-branch-input.dto.ts`).
 */
function OptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

/**
 * `POST /api/v1/admin/branches/{id}/delivery-zones` (`manager`, brief C18). The radius must be
 * larger than every ring of the branch, active or not (`RADIUS_ORDER`, brief C19); `freeOver` is
 * above `minOrder` (`OUT_OF_RANGE`, brief C20).
 */
export class AdminDeliveryZoneCreateDto {
  /** Trimmed; 1 to 100 characters. */
  @ApiProperty({ maxLength: ZONE_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ZONE_NAME_MAX_LENGTH)
  name!: string;

  /** Straight-line radius in metres from the branch pin. */
  @ApiProperty({ type: 'integer', minimum: ZONE_RADIUS_M.min, maximum: ZONE_RADIUS_M.max })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(ZONE_RADIUS_M.min)
  @Max(ZONE_RADIUS_M.max)
  radiusM!: number;

  /** Delivery fee, whole VND. */
  @ApiProperty({ type: 'integer', minimum: 0, maximum: ZONE_VND_MAX })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ZONE_VND_MAX)
  fee!: number;

  /** Minimum subtotal before any discount, whole VND. */
  @ApiProperty({ type: 'integer', minimum: 0, maximum: ZONE_VND_MAX })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ZONE_VND_MAX)
  minOrder!: number;

  /** Free delivery from this subtotal, above `minOrder`; absent or `null` when never free. */
  @ApiProperty({
    required: false,
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: ZONE_VND_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ZONE_VND_MAX)
  freeOver?: number | null;

  @ApiProperty({ type: 'integer', minimum: ZONE_ETA_MINUTES.min, maximum: ZONE_ETA_MINUTES.max })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(ZONE_ETA_MINUTES.min)
  @Max(ZONE_ETA_MINUTES.max)
  etaMinutes!: number;

  @IsDefined()
  @IsBoolean()
  isActive!: boolean;
}

/**
 * `PATCH /api/v1/admin/branches/{id}/delivery-zones/{zoneId}`: a partial change with the zone's
 * `rowVersion`. A new radius stays strictly between the neighbouring rings (`RADIUS_ORDER`);
 * `isActive: false` on the last active zone of a delivering branch is `LAST_ACTIVE_ZONE`.
 */
export class AdminDeliveryZoneUpdateDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROW_VERSION_MAX)
  rowVersion!: number;

  @ApiProperty({ required: false, maxLength: ZONE_NAME_MAX_LENGTH })
  @OptionalNotNull()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ZONE_NAME_MAX_LENGTH)
  name?: string;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: ZONE_RADIUS_M.min,
    maximum: ZONE_RADIUS_M.max,
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(ZONE_RADIUS_M.min)
  @Max(ZONE_RADIUS_M.max)
  radiusM?: number;

  @ApiProperty({ required: false, type: 'integer', minimum: 0, maximum: ZONE_VND_MAX })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ZONE_VND_MAX)
  fee?: number;

  @ApiProperty({ required: false, type: 'integer', minimum: 0, maximum: ZONE_VND_MAX })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ZONE_VND_MAX)
  minOrder?: number;

  /** `null` makes delivery never free. */
  @ApiProperty({
    required: false,
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: ZONE_VND_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ZONE_VND_MAX)
  freeOver?: number | null;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: ZONE_ETA_MINUTES.min,
    maximum: ZONE_ETA_MINUTES.max,
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(ZONE_ETA_MINUTES.min)
  @Max(ZONE_ETA_MINUTES.max)
  etaMinutes?: number;

  @ApiProperty({ required: false })
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * `POST /api/v1/admin/branches/{id}/delivery-zones/check` (`staff`, brief C24). The point is used
 * for this answer only: never stored, logged or echoed.
 */
export class DeliveryZoneCheckDto {
  @ApiProperty({ type: BranchLocationInputDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BranchLocationInputDto)
  location!: BranchLocationInputDto;
}

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------

/** One delivery ring of a branch (data-model `delivery_zones`). Money in whole VND. */
@ApiSchema({ name: 'AdminDeliveryZone' })
export class AdminDeliveryZoneDto implements AdminDeliveryZoneView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  name!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  radiusM!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  fee!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  minOrder!: number;

  @ApiProperty({ type: 'integer', nullable: true })
  freeOver!: number | null;

  @ApiProperty({ type: 'integer', minimum: 1 })
  etaMinutes!: number;

  isActive!: boolean;

  /** The zone's own `rowVersion`, sent back on `PATCH` and `DELETE`. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  rowVersion!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** `GET /api/v1/admin/branches/{id}/delivery-zones`: every ring, by radius (brief C27). */
@ApiSchema({ name: 'AdminDeliveryZoneList' })
export class AdminDeliveryZoneListDto implements AdminDeliveryZoneListView {
  @ApiProperty({ type: AdminDeliveryZoneDto, isArray: true })
  items!: AdminDeliveryZoneDto[];

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}

/** `POST .../delivery-zones/check`: the straight-line distance and the ring that would serve it. */
@ApiSchema({ name: 'DeliveryZoneCheckResult' })
export class DeliveryZoneCheckResultDto implements DeliveryZoneCheckView {
  /** Straight-line distance from the branch pin, rounded to a whole metre. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  distanceM!: number;

  /** The smallest active ring containing the point; `null` when `outOfZone`. */
  @ApiProperty({ type: AdminDeliveryZoneDto, nullable: true })
  zone!: AdminDeliveryZoneDto | null;

  outOfZone!: boolean;
}
