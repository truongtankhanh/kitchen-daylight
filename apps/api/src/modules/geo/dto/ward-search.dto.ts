import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { WARD_TYPES } from '../entities/ward.entity.js';
import type { WardType } from '../entities/ward.entity.js';
import type { WardOptionView } from '../geo.service.js';
import { PROVINCE_CODE_INPUT_MAX_LENGTH } from './list-wards-query.dto.js';

/** Searchable selects take `limit` up to 20 (api-outline, Conventions; brief B2, H3). */
export const WARD_SEARCH_LIMIT_MAX = 20;
export const WARD_SEARCH_LIMIT_DEFAULT = 20;
/** At most as many `ids[]` as one page of a select can show. */
export const WARD_SEARCH_IDS_MAX = 20;
/** A bound on `q` before any work; the longest official ward name is far shorter. */
export const WARD_SEARCH_Q_MAX_LENGTH = 100;
/** Longer than any official ward code (5 digits), so an unknown code simply matches nothing. */
export const WARD_CODE_INPUT_MAX_LENGTH = 16;

/** A repeated query parameter arrives as an array, a single one as a string. */
function toArray({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? [value] : value;
}

/**
 * Query of `GET /api/v1/admin/wards` (api-outline "Branches", brief C7; api-divergences D-146).
 * `ids` is a repeated parameter (`ids=…&ids=…`), as `roles` of `GET /admin/users`; the bracket
 * spelling `ids[]` is an unknown property (`400`), because the global validation pipe checks the
 * raw query against this class before any route pipe could rename the key.
 */
export class WardSearchQueryDto {
  /** Official province code from `GET /api/v1/provinces` (for example `79`). */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PROVINCE_CODE_INPUT_MAX_LENGTH)
  provinceCode!: string;

  /**
   * A fragment of the Vietnamese ward name, accent and case insensitive (`ba dinh` finds
   * `Ba Đình`); `%` and `_` are literal. Names that start with it come first.
   */
  @IsOptional()
  @IsString()
  @MaxLength(WARD_SEARCH_Q_MAX_LENGTH)
  q?: string;

  /** Rows returned, 1 to 20. */
  @ApiProperty({ required: false, type: 'integer', default: WARD_SEARCH_LIMIT_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WARD_SEARCH_LIMIT_MAX)
  limit: number = WARD_SEARCH_LIMIT_DEFAULT;

  /**
   * Ward codes to rebuild the chips of chosen records (`ids=…&ids=…`), at most 20; combined with
   * the other parameters, an unknown code is left out.
   */
  @ApiProperty({ required: false, type: String, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(WARD_SEARCH_IDS_MAX)
  @IsString({ each: true })
  @MaxLength(WARD_CODE_INPUT_MAX_LENGTH, { each: true })
  ids?: string[];
}

/** One ward of the staff search. */
@ApiSchema({ name: 'AdminWardOption' })
export class WardOptionDto implements WardOptionView {
  /** Official code, 5 digits, as text (for example `26743`). */
  @ApiProperty({ example: '26743' })
  code!: string;

  /** Official code of its province, 2 digits, as text. */
  @ApiProperty({ example: '79' })
  provinceCode!: string;

  /** `names.vi`: the short name without the type prefix (for example `Bến Thành`). */
  name!: string;

  @ApiProperty({ enum: WARD_TYPES, enumName: 'WardType' })
  type!: WardType;
}

/** Body of `GET /api/v1/admin/wards`. */
@ApiSchema({ name: 'AdminWardSearchResult' })
export class WardSearchResultDto {
  @ApiProperty({ type: WardOptionDto, isArray: true })
  items!: WardOptionDto[];
}
