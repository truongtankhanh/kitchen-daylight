import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { BRANCH_STATUSES } from '../entities/branch.entity.js';
import type { BranchStatus } from '../entities/branch.entity.js';
import { ROW_VERSION_MAX } from './admin-branches-query.dto.js';

// Limits of `branches` (migration 0007 CHECKs, data-model `branches` row, brief P21, C28, mobile
// G11). The bounds the documents do not give are api-divergences D-133.

/** `code`: 2 to 4 upper-case letters (`branches_code_format`). */
export const BRANCH_CODE_PATTERN = /^[A-Z]{2,4}$/;
/** `slug`: lower-case letters and digits joined by single hyphens (api-divergences D-130). */
export const BRANCH_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BRANCH_SLUG_MAX_LENGTH = 100;
export const BRANCH_NAME_MAX_LENGTH = 100;
export const BRANCH_ADDRESS_LINE_MAX_LENGTH = 200;
export const BRANCH_DESCRIPTION_MAX_LENGTH = 2000;
/** Official province and ward codes are short digit strings; a bound before the database. */
export const ADMIN_UNIT_CODE_MAX_LENGTH = 10;
/** A bound on the raw phone input (separators included) before it is matched. */
export const BRANCH_PHONE_INPUT_MAX_LENGTH = 32;
/** `website_url`: one https link of at most 255 characters (brief C28). */
export const BRANCH_WEBSITE_URL_MAX_LENGTH = 255;
/** `pause_message`: at most 200 characters (mobile G11). */
export const BRANCH_PAUSE_MESSAGE_MAX_LENGTH = 200;
/** `default_prep_minutes` and `order_cutoff_minutes`: 0 to one day. */
export const BRANCH_MINUTES_MAX = 1440;
/** `reservation_duration_minutes`: 30 to 240, in steps of 15 (brief P21). */
export const RESERVATION_DURATION = Object.freeze({ min: 30, max: 240, step: 15 });
/** `reservation_slot_step_minutes`: 15 or 30 (brief P19). */
export const RESERVATION_SLOT_STEPS = Object.freeze([15, 30] as const);
/** `reservation_max_party`: at least 1 (brief P21); the upper bound is D-133. */
export const RESERVATION_MAX_PARTY = Object.freeze({ min: 1, max: 1000 });
/** `reservation_lead_minutes`: 0 to 1440 (brief P21). */
export const RESERVATION_LEAD_MINUTES = Object.freeze({ min: 0, max: 1440 });
/** `reservation_max_days_ahead`: 1 to 90 (brief P21). */
export const RESERVATION_MAX_DAYS_AHEAD = Object.freeze({ min: 1, max: 90 });
/** A bound on `amenityIds`, far above the amenity vocabulary. */
export const AMENITY_IDS_MAX = 50;

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Optional, but never `null`: `@IsOptional()` lets `null` through, which a `NOT NULL` column must
 * not receive. With this, `undefined` skips the field and `null` fails its type check (`INVALID`).
 */
function OptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

/** `description`: translations with a required `vi` key (`branches_description_vi`). */
export class BranchDescriptionInputDto {
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRANCH_DESCRIPTION_MAX_LENGTH)
  vi!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(BRANCH_DESCRIPTION_MAX_LENGTH)
  en?: string;
}

/** The pin placed by hand on the map (brief C5, C9). WGS 84 degrees. */
export class BranchLocationInputDto {
  @ApiProperty({ minimum: -90, maximum: 90 })
  @IsDefined()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsDefined()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
}

/**
 * `POST /api/v1/admin/branches` (`ADMIN`). Every column without a default in migration 0007 is
 * required; `reservationDurationMinutes` defaults to 90. `acceptsDelivery: true` is refused: a new
 * branch has no delivery zone yet (brief C8). `websiteUrl`, `pauseMessage` and `amenityIds` are
 * set with `PATCH`.
 */
export class AdminBranchCreateDto {
  /** 2 to 4 upper-case letters, unique; the prefix of every order number. */
  @IsDefined()
  @IsString()
  @Matches(BRANCH_CODE_PATTERN)
  code!: string;

  /** Unique and immutable; derived from `name` when absent (api-divergences D-130). */
  @IsOptional()
  @IsString()
  @MaxLength(BRANCH_SLUG_MAX_LENGTH)
  @Matches(BRANCH_SLUG_PATTERN)
  slug?: string;

  /** Trimmed; 1 to 100 characters. */
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRANCH_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ required: false, type: BranchDescriptionInputDto, nullable: true })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BranchDescriptionInputDto)
  description?: BranchDescriptionInputDto | null;

  /** Street and number; trimmed, 1 to 200 characters. */
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRANCH_ADDRESS_LINE_MAX_LENGTH)
  addressLine!: string;

  /** Official province code (`GET /provinces`). */
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ADMIN_UNIT_CODE_MAX_LENGTH)
  provinceCode!: string;

  /** Official ward code of that province (`GET /wards`). */
  @ApiProperty({ required: false, type: String, nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ADMIN_UNIT_CODE_MAX_LENGTH)
  wardCode?: string | null;

  @ApiProperty({ type: BranchLocationInputDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BranchLocationInputDto)
  location!: BranchLocationInputDto;

  /** E.164 (`+` and the country code); spaces, dots and hyphens are removed first. */
  @IsDefined()
  @IsString()
  @MaxLength(BRANCH_PHONE_INPUT_MAX_LENGTH)
  phone!: string;

  @ApiProperty({ enum: BRANCH_STATUSES })
  @IsDefined()
  @IsIn(BRANCH_STATUSES)
  status!: BranchStatus;

  @IsDefined()
  @IsBoolean()
  acceptsPickup!: boolean;

  /** Must be `false` on create: no active delivery zone exists yet (brief C8). */
  @IsDefined()
  @IsBoolean()
  acceptsDelivery!: boolean;

  @IsDefined()
  @IsBoolean()
  acceptsReservations!: boolean;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: BRANCH_MINUTES_MAX })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(BRANCH_MINUTES_MAX)
  defaultPrepMinutes!: number;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: BRANCH_MINUTES_MAX })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(BRANCH_MINUTES_MAX)
  orderCutoffMinutes!: number;

  /** 30 to 240 in steps of 15; 90 when absent. */
  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: RESERVATION_DURATION.min,
    maximum: RESERVATION_DURATION.max,
    multipleOf: RESERVATION_DURATION.step,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_DURATION.min)
  @Max(RESERVATION_DURATION.max)
  reservationDurationMinutes?: number;

  /** 15 or 30. */
  @ApiProperty({ type: 'integer', enum: RESERVATION_SLOT_STEPS })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_SLOT_STEPS[0])
  @Max(RESERVATION_SLOT_STEPS[1])
  reservationSlotStepMinutes!: number;

  @ApiProperty({
    type: 'integer',
    minimum: RESERVATION_MAX_PARTY.min,
    maximum: RESERVATION_MAX_PARTY.max,
  })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_MAX_PARTY.min)
  @Max(RESERVATION_MAX_PARTY.max)
  reservationMaxParty!: number;

  @ApiProperty({
    type: 'integer',
    minimum: RESERVATION_LEAD_MINUTES.min,
    maximum: RESERVATION_LEAD_MINUTES.max,
  })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_LEAD_MINUTES.min)
  @Max(RESERVATION_LEAD_MINUTES.max)
  reservationLeadMinutes!: number;

  @ApiProperty({
    type: 'integer',
    minimum: RESERVATION_MAX_DAYS_AHEAD.min,
    maximum: RESERVATION_MAX_DAYS_AHEAD.max,
  })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_MAX_DAYS_AHEAD.min)
  @Max(RESERVATION_MAX_DAYS_AHEAD.max)
  reservationMaxDaysAhead!: number;
}

/**
 * `PATCH /api/v1/admin/branches/{id}`: any subset of the fields plus the `rowVersion` that was
 * read. `slug` is immutable and not accepted. `location` is sent only when the pin is confirmed
 * (brief C9). `amenityIds` replaces the whole list. The photo list (`media`) is A6-T9.
 */
export class AdminBranchUpdateDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROW_VERSION_MAX)
  rowVersion!: number;

  /** Refused with `LOCKED` once the branch has an order (brief C6). */
  @ApiProperty({ required: false, pattern: BRANCH_CODE_PATTERN.source })
  @OptionalNotNull()
  @IsString()
  @Matches(BRANCH_CODE_PATTERN)
  code?: string;

  @ApiProperty({ required: false, maxLength: BRANCH_NAME_MAX_LENGTH })
  @OptionalNotNull()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRANCH_NAME_MAX_LENGTH)
  name?: string;

  /** `null` removes the description. */
  @ApiProperty({ required: false, type: BranchDescriptionInputDto, nullable: true })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BranchDescriptionInputDto)
  description?: BranchDescriptionInputDto | null;

  @ApiProperty({ required: false, maxLength: BRANCH_ADDRESS_LINE_MAX_LENGTH })
  @OptionalNotNull()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRANCH_ADDRESS_LINE_MAX_LENGTH)
  addressLine?: string;

  @ApiProperty({ required: false, maxLength: ADMIN_UNIT_CODE_MAX_LENGTH })
  @OptionalNotNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ADMIN_UNIT_CODE_MAX_LENGTH)
  provinceCode?: string;

  /** `null` removes the ward. */
  @ApiProperty({ required: false, type: String, nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ADMIN_UNIT_CODE_MAX_LENGTH)
  wardCode?: string | null;

  /** Sent only when the pin is confirmed; writes `branch.location_confirm` (brief C9). */
  @ApiProperty({ required: false, type: BranchLocationInputDto })
  @OptionalNotNull()
  @IsObject()
  @ValidateNested()
  @Type(() => BranchLocationInputDto)
  location?: BranchLocationInputDto;

  @ApiProperty({ required: false, maxLength: BRANCH_PHONE_INPUT_MAX_LENGTH })
  @OptionalNotNull()
  @IsString()
  @MaxLength(BRANCH_PHONE_INPUT_MAX_LENGTH)
  phone?: string;

  @ApiProperty({ required: false, enum: BRANCH_STATUSES })
  @OptionalNotNull()
  @IsIn(BRANCH_STATUSES)
  status?: BranchStatus;

  @ApiProperty({ required: false })
  @OptionalNotNull()
  @IsBoolean()
  acceptsPickup?: boolean;

  /** Switching it on needs an active delivery zone (brief C8). */
  @ApiProperty({ required: false })
  @OptionalNotNull()
  @IsBoolean()
  acceptsDelivery?: boolean;

  @ApiProperty({ required: false })
  @OptionalNotNull()
  @IsBoolean()
  acceptsReservations?: boolean;

  @ApiProperty({ required: false, type: 'integer', minimum: 0, maximum: BRANCH_MINUTES_MAX })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(BRANCH_MINUTES_MAX)
  defaultPrepMinutes?: number;

  @ApiProperty({ required: false, type: 'integer', minimum: 0, maximum: BRANCH_MINUTES_MAX })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(BRANCH_MINUTES_MAX)
  orderCutoffMinutes?: number;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: RESERVATION_DURATION.min,
    maximum: RESERVATION_DURATION.max,
    multipleOf: RESERVATION_DURATION.step,
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_DURATION.min)
  @Max(RESERVATION_DURATION.max)
  reservationDurationMinutes?: number;

  @ApiProperty({ required: false, type: 'integer', enum: RESERVATION_SLOT_STEPS })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_SLOT_STEPS[0])
  @Max(RESERVATION_SLOT_STEPS[1])
  reservationSlotStepMinutes?: number;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: RESERVATION_MAX_PARTY.min,
    maximum: RESERVATION_MAX_PARTY.max,
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_MAX_PARTY.min)
  @Max(RESERVATION_MAX_PARTY.max)
  reservationMaxParty?: number;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: RESERVATION_LEAD_MINUTES.min,
    maximum: RESERVATION_LEAD_MINUTES.max,
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_LEAD_MINUTES.min)
  @Max(RESERVATION_LEAD_MINUTES.max)
  reservationLeadMinutes?: number;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: RESERVATION_MAX_DAYS_AHEAD.min,
    maximum: RESERVATION_MAX_DAYS_AHEAD.max,
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(RESERVATION_MAX_DAYS_AHEAD.min)
  @Max(RESERVATION_MAX_DAYS_AHEAD.max)
  reservationMaxDaysAhead?: number;

  /** One https link of at most 255 characters; `null` removes it (brief C28). */
  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    maxLength: BRANCH_WEBSITE_URL_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BRANCH_WEBSITE_URL_MAX_LENGTH)
  websiteUrl?: string | null;

  /**
   * The line the customer app shows on a paused branch (mobile G11); `null` removes it. Resuming
   * orders does not clear it.
   */
  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    maxLength: BRANCH_PAUSE_MESSAGE_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(BRANCH_PAUSE_MESSAGE_MAX_LENGTH)
  pauseMessage?: string | null;

  /** Replaces the whole list in one transaction; `[]` removes every amenity. */
  @ApiProperty({ required: false, type: String, format: 'uuid', isArray: true })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(AMENITY_IDS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  amenityIds?: string[];
}
