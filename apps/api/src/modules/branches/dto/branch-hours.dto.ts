import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import type {
  AdminBranchHoursView,
  BranchHoursPeriodView,
  BranchSpecialDayView,
  TodayHoursView,
} from '../branch-hours.service.js';
import { BRANCH_SERVICES } from '../entities/branch-opening-period.entity.js';
import type { BranchService } from '../entities/branch-opening-period.entity.js';
import {
  HOURS_PERIODS_MAX,
  HOURS_SPECIAL_MAX,
  HOURS_TIME_PATTERN,
  SPECIAL_DISPLAY_NOTE_MAX_LENGTH,
  SPECIAL_NOTE_MAX_LENGTH,
} from '../hours/hours-validation.js';
import { ROW_VERSION_MAX } from './admin-branches-query.dto.js';

/** `"true"` and `"false"` of a query string as booleans; anything else fails `@IsBoolean`. */
function queryBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') {
    return true;
  }
  return value === 'false' ? false : value;
}

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

/** Query of `GET /api/v1/admin/branches/{id}/hours`: the page of special days. */
export class BranchHoursQueryDto extends PageQueryDto {
  /**
   * Also the special days that ended within the last 30 days, never older (brief C17; the name is
   * a proposal, api-divergences D-138).
   */
  @ApiProperty({ required: false, type: Boolean, default: false })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  includePast?: boolean;
}

/**
 * One weekly period of `PUT`. Schema only: the items are checked by `validateHours`
 * (`hours/hours-validation.ts`), so every item error has the path `periods[i].field`.
 */
export class BranchHoursPeriodInputDto {
  @ApiProperty({ enum: BRANCH_SERVICES })
  service!: BranchService;

  /** 1 (Monday) to 7 (Sunday). */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 7 })
  dayOfWeek!: number;

  /** `HH:mm`, 00:00 to 23:59. */
  @ApiProperty({ pattern: HOURS_TIME_PATTERN.source })
  openTime!: string;

  /** `HH:mm`; at or before `openTime` means the next day. A 24-hour day is 00:00 to 23:59. */
  @ApiProperty({ pattern: HOURS_TIME_PATTERN.source })
  closeTime!: string;
}

/** One special day (or range) of `PUT`. Schema only, as `BranchHoursPeriodInputDto`. */
export class BranchSpecialDayInputDto {
  @ApiProperty({ format: 'date' })
  startsOn!: string;

  /** On or after `startsOn`, and today or later. */
  @ApiProperty({ format: 'date' })
  endsOn!: string;

  @ApiProperty({ enum: BRANCH_SERVICES })
  service!: BranchService;

  isClosed!: boolean;

  /** Required on an open day, absent or `null` on a closed one. */
  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    pattern: HOURS_TIME_PATTERN.source,
  })
  openTime?: string | null;

  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    pattern: HOURS_TIME_PATTERN.source,
  })
  closeTime?: string | null;

  /** Internal, never shown to customers (brief C13). */
  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    maxLength: SPECIAL_NOTE_MAX_LENGTH,
  })
  note?: string | null;

  /** Customer-facing, for example "Nghỉ Tết" (mobile G12). */
  @ApiProperty({
    required: false,
    type: String,
    nullable: true,
    maxLength: SPECIAL_DISPLAY_NOTE_MAX_LENGTH,
  })
  displayNote?: string | null;
}

/**
 * `PUT /api/v1/admin/branches/{id}/hours`: the whole weekly list and the special days that end
 * today or later, with the branch `rowVersion`. `closesNextDay` is derived by the server and is
 * refused when sent.
 */
export class BranchHoursUpdateDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROW_VERSION_MAX)
  rowVersion!: number;

  @ApiProperty({ type: BranchHoursPeriodInputDto, isArray: true, maxItems: HOURS_PERIODS_MAX })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(HOURS_PERIODS_MAX)
  periods!: unknown[];

  @ApiProperty({ type: BranchSpecialDayInputDto, isArray: true, maxItems: HOURS_SPECIAL_MAX })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(HOURS_SPECIAL_MAX)
  special!: unknown[];
}

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------

@ApiSchema({ name: 'BranchHoursPeriod' })
export class BranchHoursPeriodDto implements BranchHoursPeriodView {
  @ApiProperty({ enum: BRANCH_SERVICES })
  service!: BranchService;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 7 })
  dayOfWeek!: number;

  /** `HH:mm`. */
  openTime!: string;

  /** `HH:mm`. */
  closeTime!: string;

  /** Derived: true when `closeTime` is at or before `openTime`. */
  closesNextDay!: boolean;
}

@ApiSchema({ name: 'BranchSpecialDay' })
export class BranchSpecialDayDto implements BranchSpecialDayView {
  @ApiProperty({ format: 'date' })
  startsOn!: string;

  @ApiProperty({ format: 'date' })
  endsOn!: string;

  @ApiProperty({ enum: BRANCH_SERVICES })
  service!: BranchService;

  isClosed!: boolean;

  @ApiProperty({ type: String, nullable: true })
  openTime!: string | null;

  @ApiProperty({ type: String, nullable: true })
  closeTime!: string | null;

  @ApiProperty({ type: Boolean, nullable: true })
  closesNextDay!: boolean | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: String, nullable: true })
  displayNote!: string | null;
}

@ApiSchema({ name: 'BranchSpecialDayPage' })
export class BranchSpecialDayPageDto {
  @ApiProperty({ type: BranchSpecialDayDto, isArray: true })
  items!: BranchSpecialDayDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}

/** `GET` and `PUT /api/v1/admin/branches/{id}/hours`. */
@ApiSchema({ name: 'AdminBranchHours' })
export class AdminBranchHoursDto implements AdminBranchHoursView {
  /** The branch `rowVersion`. */
  @ApiProperty({ type: 'integer', minimum: 1 })
  rowVersion!: number;

  @ApiProperty({ type: BranchHoursPeriodDto, isArray: true })
  periods!: BranchHoursPeriodDto[];

  @ApiProperty({ type: BranchSpecialDayPageDto })
  special!: BranchSpecialDayPageDto;
}

/** One session of `todayHours` in `AdminBranchRow` (a proposal, api-divergences D-139). */
@ApiSchema({ name: 'TodayHoursSession' })
export class TodayHoursSessionDto implements TodayHoursView {
  /** `HH:mm`. */
  openTime!: string;

  /** `HH:mm`. */
  closeTime!: string;

  closesNextDay!: boolean;
}
