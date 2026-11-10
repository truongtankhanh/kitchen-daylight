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
import { TAG_KINDS } from '../entities/tag.entity.js';
import type { TagKind } from '../entities/tag.entity.js';
import type { AdminTagPageView, AdminTagView, TagNamesView } from '../tags.service.js';

// Limits of `/admin/tags` (api-outline "Menu and stock"; migration 0015). The data model gives no
// length for a tag name or slug (api-divergences D-158).

/** One translated tag name, trimmed: 1 to 60 characters for `vi`, at most 60 for `en` (D-158). */
export const TAG_NAME_MAX_LENGTH = 60;
/** `slug`: the slug shape, at most 60 characters; derived from `names.vi` when absent (D-158). */
export const TAG_SLUG_MAX_LENGTH = 60;
/** A bound on `q` before any work. */
export const TAG_Q_MAX_LENGTH = 100;
/** Searchable selects take `limit` up to 20 and as many `ids` (api-outline Conventions; D-159). */
export const TAG_SELECT_LIMIT_MAX = 20;
export const TAG_SELECT_IDS_MAX = 20;
/** Highest `rowVersion` a client can send: the PostgreSQL `integer` maximum. */
export const TAG_ROW_VERSION_MAX = 2_147_483_647;

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

/** `names`: short labels with a required `vi` key (`tags_names_vi`); `en` optional. */
@ApiSchema({ name: 'TagNames' })
export class TagNamesDto implements TagNamesView {
  @ApiProperty({ maxLength: TAG_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NAME_MAX_LENGTH)
  vi!: string;

  /** Blank is dropped. */
  @ApiProperty({ required: false, maxLength: TAG_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TAG_NAME_MAX_LENGTH)
  en?: string;
}

/**
 * Query of `GET /api/v1/admin/tags`: a page of the list, or with `limit` the first rows for a
 * searchable select (api-divergences D-159). Sorted by `kind` (`DIETARY`, `ALLERGEN`, `LABEL`), the
 * unaccented Vietnamese name, then `id`.
 */
export class AdminTagsQueryDto extends PageQueryDto {
  /** A fragment of the Vietnamese name, accent and case insensitive; `%` and `_` are literal. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(TAG_Q_MAX_LENGTH)
  q?: string;

  @ApiProperty({ required: false, enum: TAG_KINDS, enumName: 'TagKind' })
  @IsOptional()
  @IsIn(TAG_KINDS)
  kind?: TagKind;

  /** Select mode: the first `limit` rows (1 to 20); `page` and `pageSize` are then ignored. */
  @ApiProperty({ required: false, type: 'integer', minimum: 1, maximum: TAG_SELECT_LIMIT_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAG_SELECT_LIMIT_MAX)
  limit?: number;

  /** Tag ids to rebuild the chips of chosen records (`ids=…&ids=…`), at most 20; AND-ed. */
  @ApiProperty({ required: false, type: String, format: 'uuid', isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(TAG_SELECT_IDS_MAX)
  @IsUUID('all', { each: true })
  ids?: string[];
}

/** `POST /api/v1/admin/tags` (`manager`, brief B24). */
export class AdminTagCreateDto {
  @ApiProperty({ enum: TAG_KINDS, enumName: 'TagKind' })
  @IsDefined()
  @IsIn(TAG_KINDS)
  kind!: TagKind;

  /** Unique and immutable; derived from `names.vi` when absent (`ALREADY_EXISTS` when taken). */
  @ApiProperty({ required: false, maxLength: TAG_SLUG_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(TAG_SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN)
  slug?: string;

  @ApiProperty({ type: TagNamesDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => TagNamesDto)
  names!: TagNamesDto;
}

/**
 * `PATCH /api/v1/admin/tags/{id}`: a partial change with the tag's `rowVersion`. `slug` is not
 * accepted (D-158). A new `kind` on a tag that items use is `IN_USE` (brief B30).
 */
export class AdminTagUpdateDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAG_ROW_VERSION_MAX)
  rowVersion!: number;

  @ApiProperty({ required: false, enum: TAG_KINDS, enumName: 'TagKind' })
  @OptionalNotNull()
  @IsIn(TAG_KINDS)
  kind?: TagKind;

  /** Replaces the whole `names` object. */
  @ApiProperty({ required: false, type: TagNamesDto })
  @OptionalNotNull()
  @IsObject()
  @ValidateNested()
  @Type(() => TagNamesDto)
  names?: TagNamesDto;
}

/** Query of `DELETE /api/v1/admin/tags/{id}`: the version the dialog was showing. */
export class AdminTagDeleteQueryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TAG_ROW_VERSION_MAX)
  rowVersion!: number;
}

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------

/** One tag of the admin list (data-model `tags`) with its usage counts (brief B27, B31). */
@ApiSchema({ name: 'AdminTag' })
export class AdminTagDto implements AdminTagView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TAG_KINDS, enumName: 'TagKind' })
  kind!: TagKind;

  slug!: string;

  @ApiProperty({ type: TagNamesDto })
  names!: TagNamesDto;

  /** Items, not soft-deleted, that carry the tag. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  itemCount!: number;

  /** Unconfirmed claims on those items; always 0 for a `LABEL` tag (nothing to verify). */
  @ApiProperty({ type: 'integer', minimum: 0 })
  unverifiedCount!: number;

  /** Branches, not soft-deleted, that sell at least one of those items. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  branchCount!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  rowVersion!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** `GET /api/v1/admin/tags`: an offset page. */
@ApiSchema({ name: 'AdminTagPage' })
export class AdminTagPageDto implements AdminTagPageView {
  @ApiProperty({ type: AdminTagDto, isArray: true })
  items!: AdminTagDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}
