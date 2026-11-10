import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
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

import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import { SLUG_PATTERN } from '../../../common/text/slugify.js';
import type {
  AdminAmenityPageView,
  AdminAmenityView,
  AmenityNamesView,
} from '../amenities.service.js';
import { AMENITY_ICONS } from '../amenity-icons.js';
import type { AmenityIcon } from '../amenity-icons.js';
import { ROW_VERSION_MAX } from './admin-branches-query.dto.js';

// Limits of `/admin/amenities` (api-outline "Menu and stock"; migration 0013). The data model gives
// no length for an amenity name or code (api-divergences D-158).

/** One translated amenity name, trimmed: 1 to 60 characters for `vi`, at most 60 for `en`. */
export const AMENITY_NAME_MAX_LENGTH = 60;
/** `code`: the slug shape, at most 60 characters; derived from `names.vi` when absent. */
export const AMENITY_CODE_MAX_LENGTH = 60;
/** A bound on `q` before any work. */
export const AMENITY_Q_MAX_LENGTH = 100;
/** Searchable selects take `limit` up to 20 and as many `ids` (api-outline Conventions; D-159). */
export const AMENITY_SELECT_LIMIT_MAX = 20;
export const AMENITY_SELECT_IDS_MAX = 20;

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** A repeated query parameter arrives as an array, a single one as a string. */
function toArray({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? [value] : value;
}

/** Optional, but never `null` (as in `admin-branch-input.dto.ts`). */
function OptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

/** `names`: short labels with a required `vi` key (`amenities_names_vi`); `en` optional. */
@ApiSchema({ name: 'AmenityNames' })
export class AmenityNamesDto implements AmenityNamesView {
  @ApiProperty({ maxLength: AMENITY_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AMENITY_NAME_MAX_LENGTH)
  vi!: string;

  /** Blank is dropped. */
  @ApiProperty({ required: false, maxLength: AMENITY_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(AMENITY_NAME_MAX_LENGTH)
  en?: string;
}

/**
 * Query of `GET /api/v1/admin/amenities`: a page of the list, or with `limit` the first rows for a
 * searchable select (D-159). Sorted by the unaccented Vietnamese name, then `id`.
 */
export class AdminAmenitiesQueryDto extends PageQueryDto {
  /** A fragment of the Vietnamese name, accent and case insensitive; `%` and `_` are literal. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(AMENITY_Q_MAX_LENGTH)
  q?: string;

  /** Select mode: the first `limit` rows (1 to 20); `page` and `pageSize` are then ignored. */
  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: 1,
    maximum: AMENITY_SELECT_LIMIT_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AMENITY_SELECT_LIMIT_MAX)
  limit?: number;

  /** Amenity ids to rebuild the chips of chosen records (`ids=…&ids=…`), at most 20; AND-ed. */
  @ApiProperty({ required: false, type: String, format: 'uuid', isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(AMENITY_SELECT_IDS_MAX)
  @IsUUID('all', { each: true })
  ids?: string[];
}

/** `POST /api/v1/admin/amenities` (`admin`, brief B24, B32). */
export class AdminAmenityCreateDto {
  /** Unique and immutable; derived from `names.vi` when absent (`ALREADY_EXISTS` when taken). */
  @ApiProperty({ required: false, maxLength: AMENITY_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(AMENITY_CODE_MAX_LENGTH)
  @Matches(SLUG_PATTERN)
  code?: string;

  @ApiProperty({ type: AmenityNamesDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AmenityNamesDto)
  names!: AmenityNamesDto;

  /** One key of the fixed list (`amenity-icons.ts`); anything else is `INVALID` on `icon`. */
  @ApiProperty({ enum: AMENITY_ICONS, enumName: 'AmenityIcon' })
  @IsDefined()
  @IsIn(AMENITY_ICONS)
  icon!: AmenityIcon;
}

/** `PATCH /api/v1/admin/amenities/{id}`: a partial change with the `rowVersion`; no `code`. */
export class AdminAmenityUpdateDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ROW_VERSION_MAX)
  rowVersion!: number;

  /** Replaces the whole `names` object. */
  @ApiProperty({ required: false, type: AmenityNamesDto })
  @OptionalNotNull()
  @IsObject()
  @ValidateNested()
  @Type(() => AmenityNamesDto)
  names?: AmenityNamesDto;

  @ApiProperty({ required: false, enum: AMENITY_ICONS, enumName: 'AmenityIcon' })
  @OptionalNotNull()
  @IsIn(AMENITY_ICONS)
  icon?: AmenityIcon;
}

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------

/** One amenity of the admin list (data-model `amenities`) with the branches that show it. */
@ApiSchema({ name: 'AdminAmenity' })
export class AdminAmenityDto implements AdminAmenityView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  code!: string;

  @ApiProperty({ type: AmenityNamesDto })
  names!: AmenityNamesDto;

  @ApiProperty({ enum: AMENITY_ICONS, enumName: 'AmenityIcon' })
  icon!: AmenityIcon;

  /** Branches, not soft-deleted, that show the amenity. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  branchCount!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  rowVersion!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** `GET /api/v1/admin/amenities`: an offset page. */
@ApiSchema({ name: 'AdminAmenityPage' })
export class AdminAmenityPageDto implements AdminAmenityPageView {
  @ApiProperty({ type: AdminAmenityDto, isArray: true })
  items!: AdminAmenityDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}
