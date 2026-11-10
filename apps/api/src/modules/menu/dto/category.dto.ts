import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
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
import { CATEGORY_ICON_PATTERN } from '../categories.service.js';
import type {
  AdminCategoryListView,
  AdminCategoryPageView,
  AdminCategoryView,
  CategoryItemsOrderView,
  CategoryNamesView,
  MenuItemPositionView,
} from '../categories.service.js';

// Limits of `/admin/menu-categories` (api-outline "Menu and stock"; migration 0015). The data model
// gives no length for a category name or slug: the same bounds as a tag (api-divergences D-158,
// D-163).

/** One translated category name, trimmed: 1 to 60 characters for `vi`, at most 60 for `en`. */
export const CATEGORY_NAME_MAX_LENGTH = 60;
/** `slug`: the slug shape, at most 60 characters; derived from `names.vi` when absent. */
export const CATEGORY_SLUG_MAX_LENGTH = 60;
/** `icon`: at most 40 characters (`CATEGORY_ICON_PATTERN`). */
export const CATEGORY_ICON_MAX_LENGTH = 40;
/** `sortOrder`: 1 to 1,000,000 (D-163); a reorder writes 1 to N. */
export const CATEGORY_SORT_ORDER = Object.freeze({ min: 1, max: 1_000_000 });
/** A bound on `q` before any work. */
export const CATEGORY_Q_MAX_LENGTH = 100;
/** A bound on `ids` of a reorder and `itemIds` of an items order, far above a real menu (D-164). */
export const CATEGORY_REORDER_MAX = 500;
/** Highest `rowVersion` a client can send: the PostgreSQL `integer` maximum. */
export const CATEGORY_ROW_VERSION_MAX = 2_147_483_647;

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Optional, but never `null` (as in `admin-branch-input.dto.ts`). */
function OptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

/** Optional and nullable: `undefined` skips the field, `null` is kept (it clears the column). */
function OptionalNullable(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined && value !== null);
}

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

/** `names`: short labels with a required `vi` key (`menu_categories_names_vi`); `en` optional. */
@ApiSchema({ name: 'CategoryNames' })
export class CategoryNamesDto implements CategoryNamesView {
  @ApiProperty({ maxLength: CATEGORY_NAME_MAX_LENGTH })
  @Transform(trimmed)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATEGORY_NAME_MAX_LENGTH)
  vi!: string;

  /** Blank is dropped. */
  @ApiProperty({ required: false, maxLength: CATEGORY_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(CATEGORY_NAME_MAX_LENGTH)
  en?: string;
}

/**
 * Query of `GET /api/v1/admin/menu-categories` (brief B27, B31). Sorted by `sortOrder`, the
 * unaccented Vietnamese name, then `id`.
 */
export class AdminCategoriesQueryDto extends PageQueryDto {
  /** A fragment of the Vietnamese name, accent and case insensitive; `%` and `_` are literal. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(CATEGORY_Q_MAX_LENGTH)
  q?: string;
}

/** `POST /api/v1/admin/menu-categories` (`manager`). */
export class AdminCategoryCreateDto {
  @ApiProperty({ type: CategoryNamesDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CategoryNamesDto)
  names!: CategoryNamesDto;

  /** Unique and immutable; derived from `names.vi` when absent (`ALREADY_EXISTS` when taken). */
  @ApiProperty({ required: false, maxLength: CATEGORY_SLUG_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CATEGORY_SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN)
  slug?: string;

  /**
   * A lower-case key (letters, digits, hyphens; at most 40) for the Home category row (mobile G6);
   * `null` or absent for none. The list of keys is not written yet, so only the shape is checked.
   */
  @ApiProperty({ required: false, nullable: true, maxLength: CATEGORY_ICON_MAX_LENGTH })
  @OptionalNullable()
  @IsString()
  @Matches(CATEGORY_ICON_PATTERN)
  icon?: string | null;

  /** Position in the list; after the last category when absent. */
  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: CATEGORY_SORT_ORDER.min,
    maximum: CATEGORY_SORT_ORDER.max,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CATEGORY_SORT_ORDER.min)
  @Max(CATEGORY_SORT_ORDER.max)
  sortOrder?: number;

  /** `false` hides the category and its items from customers (brief B29, A7-T2). */
  @IsDefined()
  @IsBoolean()
  isActive!: boolean;
}

/** `PATCH /api/v1/admin/menu-categories/{id}`: a partial change with the `rowVersion`; no `slug`. */
export class AdminCategoryUpdateDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CATEGORY_ROW_VERSION_MAX)
  rowVersion!: number;

  /** Replaces the whole `names` object. */
  @ApiProperty({ required: false, type: CategoryNamesDto })
  @OptionalNotNull()
  @IsObject()
  @ValidateNested()
  @Type(() => CategoryNamesDto)
  names?: CategoryNamesDto;

  /** `null` clears it. */
  @ApiProperty({ required: false, nullable: true, maxLength: CATEGORY_ICON_MAX_LENGTH })
  @OptionalNullable()
  @IsString()
  @Matches(CATEGORY_ICON_PATTERN)
  icon?: string | null;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: CATEGORY_SORT_ORDER.min,
    maximum: CATEGORY_SORT_ORDER.max,
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(CATEGORY_SORT_ORDER.min)
  @Max(CATEGORY_SORT_ORDER.max)
  sortOrder?: number;

  @ApiProperty({ required: false })
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

/** Query of `DELETE /api/v1/admin/menu-categories/{id}`: the version the dialog was showing. */
export class AdminCategoryDeleteQueryDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CATEGORY_ROW_VERSION_MAX)
  rowVersion!: number;
}

/**
 * `POST /api/v1/admin/menu-categories/reorder` (brief B28): every category id in the new order,
 * and `rowVersions[i]` the version of `ids[i]` as the screen read it (parallel arrays; D-164).
 */
export class AdminCategoryReorderDto {
  @ApiProperty({ type: String, format: 'uuid', isArray: true, maxItems: CATEGORY_REORDER_MAX })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(CATEGORY_REORDER_MAX)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiProperty({ type: 'integer', isArray: true, maxItems: CATEGORY_REORDER_MAX })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(CATEGORY_REORDER_MAX)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(CATEGORY_ROW_VERSION_MAX, { each: true })
  rowVersions!: number[];
}

/** `PUT /api/v1/admin/menu-categories/{id}/items-order` (brief B4): every live item of it, in order. */
export class AdminCategoryItemsOrderDto {
  @ApiProperty({ type: String, format: 'uuid', isArray: true, maxItems: CATEGORY_REORDER_MAX })
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(CATEGORY_REORDER_MAX)
  @IsUUID('all', { each: true })
  itemIds!: string[];
}

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------

/** One category of the admin list (data-model `menu_categories`) with its live items. */
@ApiSchema({ name: 'AdminMenuCategory' })
export class AdminCategoryDto implements AdminCategoryView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  slug!: string;

  @ApiProperty({ type: CategoryNamesDto })
  names!: CategoryNamesDto;

  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;

  @ApiProperty({ type: 'integer' })
  sortOrder!: number;

  isActive!: boolean;

  /** Items, not soft-deleted, in the category. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  itemCount!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  rowVersion!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** `GET /api/v1/admin/menu-categories`: an offset page. */
@ApiSchema({ name: 'AdminMenuCategoryPage' })
export class AdminCategoryPageDto implements AdminCategoryPageView {
  @ApiProperty({ type: AdminCategoryDto, isArray: true })
  items!: AdminCategoryDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}

/** `POST /api/v1/admin/menu-categories/reorder`: every category in the new order. */
@ApiSchema({ name: 'AdminMenuCategoryList' })
export class AdminCategoryListDto implements AdminCategoryListView {
  @ApiProperty({ type: AdminCategoryDto, isArray: true })
  items!: AdminCategoryDto[];

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}

/** One item after `items-order`: its new position and the version its trigger raised. */
@ApiSchema({ name: 'AdminMenuItemPosition' })
export class MenuItemPositionDto implements MenuItemPositionView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  sortOrder!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  rowVersion!: number;
}

/** `PUT /api/v1/admin/menu-categories/{id}/items-order`: the items in their new order. */
@ApiSchema({ name: 'AdminMenuCategoryItemsOrder' })
export class CategoryItemsOrderDto implements CategoryItemsOrderView {
  @ApiProperty({ type: MenuItemPositionDto, isArray: true })
  items!: MenuItemPositionDto[];
}
