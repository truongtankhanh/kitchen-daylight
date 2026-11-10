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

import { ADMIN_ROLES, Roles } from '../../common/auth/roles.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { AmenitiesService } from './amenities.service.js';
import type { AdminAmenityPageView, AdminAmenityView } from './amenities.service.js';
import { AdminBranchDeleteQueryDto } from './dto/admin-branches-query.dto.js';
import {
  AdminAmenitiesQueryDto,
  AdminAmenityCreateDto,
  AdminAmenityDto,
  AdminAmenityPageDto,
  AdminAmenityUpdateDto,
} from './dto/amenity.dto.js';

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

/**
 * `/admin/amenities` (api-outline "Menu and stock"; A6-T5; brief B24, B32). `ADMIN` only, so no
 * branch-scope marker is needed; anyone else gets `403 FORBIDDEN` from `RolesGuard`.
 */
@Roles(...ADMIN_ROLES)
@Controller('admin/amenities')
export class AdminAmenitiesController {
  constructor(@Inject(AmenitiesService) private readonly amenities: AmenitiesService) {}

  /**
   * A page (`page`, `pageSize`) or, with `limit`, the first rows for a select; filters `q` and
   * `ids`. Sorted by unaccented name, then `id`; each row has `branchCount`.
   */
  @Get()
  @ApiOkResponse({ type: AdminAmenityPageDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  list(
    @Query(new ValidatedAs(AdminAmenitiesQueryDto)) query: AdminAmenitiesQueryDto,
  ): Promise<AdminAmenityPageView> {
    return this.amenities.list(query);
  }

  /** A new amenity; the code is derived from `names.vi` when absent (`ALREADY_EXISTS`). */
  @Post()
  @ApiCreatedResponse({ type: AdminAmenityDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'ALREADY_EXISTS',
    'RATE_LIMITED',
  )
  create(
    @Body(new ValidatedAs(AdminAmenityCreateDto)) body: AdminAmenityCreateDto,
  ): Promise<AdminAmenityView> {
    return this.amenities.create(body);
  }

  /** `names` and `icon` with the amenity `rowVersion`. */
  @Patch(':id')
  @ApiOkResponse({ type: AdminAmenityDto })
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AdminAmenityUpdateDto)) body: AdminAmenityUpdateDto,
  ): Promise<AdminAmenityView> {
    return this.amenities.update(id, body);
  }

  /** Hard delete; `IN_USE` with `usage` while a branch shows the amenity (B24). */
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
    @Query(new ValidatedAs(AdminBranchDeleteQueryDto)) query: AdminBranchDeleteQueryDto,
  ): Promise<void> {
    await this.amenities.remove(id, query.rowVersion);
  }
}
