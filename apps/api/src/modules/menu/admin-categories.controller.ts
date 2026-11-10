import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { MANAGER_ROLES, Roles } from '../../common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../common/branch-scope/branch-scope.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { CategoriesService } from './categories.service.js';
import type {
  AdminCategoryListView,
  AdminCategoryPageView,
  AdminCategoryView,
  CategoryItemsOrderView,
} from './categories.service.js';
import {
  AdminCategoriesQueryDto,
  AdminCategoryCreateDto,
  AdminCategoryDeleteQueryDto,
  AdminCategoryDto,
  AdminCategoryItemsOrderDto,
  AdminCategoryListDto,
  AdminCategoryPageDto,
  AdminCategoryReorderDto,
  AdminCategoryUpdateDto,
  CategoryItemsOrderDto,
} from './dto/category.dto.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (as `ValidatedAs` in `admin-branches.controller.ts`; decision 0007 section 2).
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/** Categories are shared by all branches (data-model `menu_categories`). */
const BRAND_WIDE =
  'Menu categories are brand-wide: no branch path or query; the item counts cover every branch.';

/**
 * `/admin/menu-categories` (api-outline "Menu and stock"; A6-T6; brief B4, B25 to B28, B31).
 * `MANAGER` and `ADMIN`; anyone else gets `403 FORBIDDEN` from `RolesGuard`.
 */
@Roles(...MANAGER_ROLES)
@NotBranchScoped(BRAND_WIDE)
@Controller('admin/menu-categories')
export class AdminCategoriesController {
  constructor(@Inject(CategoriesService) private readonly categories: CategoriesService) {}

  /** A page sorted by `sortOrder`, unaccented name, `id`; each row has `itemCount`. */
  @Get()
  @ApiOkResponse({ type: AdminCategoryPageDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  list(
    @Query(new ValidatedAs(AdminCategoriesQueryDto)) query: AdminCategoriesQueryDto,
  ): Promise<AdminCategoryPageView> {
    return this.categories.list(query);
  }

  /** A new category; the slug is derived from `names.vi` when absent (`ALREADY_EXISTS`). */
  @Post()
  @ApiCreatedResponse({ type: AdminCategoryDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'ALREADY_EXISTS',
    'RATE_LIMITED',
  )
  create(
    @CurrentUser() actor: RequestUser,
    @Body(new ValidatedAs(AdminCategoryCreateDto)) body: AdminCategoryCreateDto,
  ): Promise<AdminCategoryView> {
    return this.categories.create(actor, body);
  }

  /**
   * Every category in a new order, `sort_order` 1 to N in one transaction (brief B28). `ids` must
   * list them all once; the first stale `rowVersions[i]` is `STALE_VERSION`, nothing changed.
   */
  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminCategoryListDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'STALE_VERSION',
    'RATE_LIMITED',
  )
  reorder(
    @CurrentUser() actor: RequestUser,
    @Body(new ValidatedAs(AdminCategoryReorderDto)) body: AdminCategoryReorderDto,
  ): Promise<AdminCategoryListView> {
    return this.categories.reorder(actor, body);
  }

  /** `names`, `icon`, `sortOrder` and `isActive` with the category `rowVersion`. */
  @Patch(':id')
  @ApiOkResponse({ type: AdminCategoryDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'STALE_VERSION',
    'RATE_LIMITED',
  )
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AdminCategoryUpdateDto)) body: AdminCategoryUpdateDto,
  ): Promise<AdminCategoryView> {
    return this.categories.update(actor, id, body);
  }

  /** The live items of the category in a new order, `sort_order` 1 to N (brief B4). */
  @Put(':id/items-order')
  @ApiOkResponse({ type: CategoryItemsOrderDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  reorderItems(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AdminCategoryItemsOrderDto)) body: AdminCategoryItemsOrderDto,
  ): Promise<CategoryItemsOrderView> {
    return this.categories.reorderItems(actor, id, body.itemIds);
  }

  /** Hard delete of a category no item references; `IN_USE` with `usage` otherwise (B25, B26). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'STALE_VERSION',
    'IN_USE',
    'RATE_LIMITED',
  )
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ValidatedAs(AdminCategoryDeleteQueryDto)) query: AdminCategoryDeleteQueryDto,
  ): Promise<void> {
    await this.categories.remove(id, query.rowVersion);
  }
}
