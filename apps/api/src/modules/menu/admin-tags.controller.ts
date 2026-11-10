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
import {
  AdminTagCreateDto,
  AdminTagDeleteQueryDto,
  AdminTagDto,
  AdminTagPageDto,
  AdminTagsQueryDto,
  AdminTagUpdateDto,
} from './dto/tag.dto.js';
import { TagsService } from './tags.service.js';
import type { AdminTagPageView, AdminTagView } from './tags.service.js';

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

/** Tags are one vocabulary for the whole brand (data-model `tags`; api-outline "Menu and stock"). */
const BRAND_WIDE =
  'Tags are brand-wide reference data: no branch path or query; the counts cover every branch.';

/**
 * `/admin/tags` (api-outline "Menu and stock"; A6-T5; brief B24, B27, B30, B31). `MANAGER` and
 * `ADMIN`; anyone else gets `403 FORBIDDEN` from `RolesGuard`. The `verified` flag of a claim is
 * set on the item (A6-T7), not here.
 */
@Roles(...MANAGER_ROLES)
@NotBranchScoped(BRAND_WIDE)
@Controller('admin/tags')
export class AdminTagsController {
  constructor(@Inject(TagsService) private readonly tags: TagsService) {}

  /**
   * A page (`page`, `pageSize`) or, with `limit`, the first rows for a select; filters `q`, `kind`
   * and `ids`. Sorted by `kind`, unaccented name, `id`. Each row has `itemCount`,
   * `unverifiedCount` and `branchCount`.
   */
  @Get()
  @ApiOkResponse({ type: AdminTagPageDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  list(
    @Query(new ValidatedAs(AdminTagsQueryDto)) query: AdminTagsQueryDto,
  ): Promise<AdminTagPageView> {
    return this.tags.list(query);
  }

  /** A new tag; the slug is derived from `names.vi` when absent (`ALREADY_EXISTS` when taken). */
  @Post()
  @ApiCreatedResponse({ type: AdminTagDto })
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
    @Body(new ValidatedAs(AdminTagCreateDto)) body: AdminTagCreateDto,
  ): Promise<AdminTagView> {
    return this.tags.create(actor, body);
  }

  /** `kind` and `names` with the tag `rowVersion`; a new `kind` on a used tag is `IN_USE` (B30). */
  @Patch(':id')
  @ApiOkResponse({ type: AdminTagDto })
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
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AdminTagUpdateDto)) body: AdminTagUpdateDto,
  ): Promise<AdminTagView> {
    return this.tags.update(actor, id, body);
  }

  /** Hard delete; `IN_USE` with `usage` while items carry the tag (B24). */
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
    @Query(new ValidatedAs(AdminTagDeleteQueryDto)) query: AdminTagDeleteQueryDto,
  ): Promise<void> {
    await this.tags.remove(id, query.rowVersion);
  }
}
