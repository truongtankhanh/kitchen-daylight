import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { Roles, STAFF_ROLES } from '../../common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../common/branch-scope/branch-scope.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { WardSearchQueryDto, WardSearchResultDto } from './dto/ward-search.dto.js';
import { GeoService } from './geo.service.js';
import type { WardOptionView } from './geo.service.js';

/**
 * The global validation pipe with the DTO class named here (as `ValidatedAs` in
 * `geo.controller.ts`; decision 0007 section 2).
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * `GET /admin/wards` (api-outline "Branches"; brief C7; A5-T5): the server-side ward search of the
 * branch editor's select. `staff` (`STAFF`, `MANAGER`, `ADMIN`); customers get `403` from
 * `RolesGuard`, a request without a token `401`. Reference data, so no branch scoping.
 */
@Roles(...STAFF_ROLES)
@Controller('admin/wards')
export class AdminWardsController {
  constructor(@Inject(GeoService) private readonly geo: GeoService) {}

  /**
   * Wards of one province matching `q` (accent and case insensitive, prefix matches first), at
   * most `limit` (20); repeated `ids` rebuild the chips of chosen wards. `{ items }`, never paged.
   */
  @Get()
  @NotBranchScoped('Reference data (wards of a province); reads no branch data.')
  @ApiOkResponse({ type: WardSearchResultDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  async search(
    @Query(new ValidatedAs(WardSearchQueryDto)) query: WardSearchQueryDto,
  ): Promise<{ items: WardOptionView[] }> {
    return { items: await this.geo.searchWards(query) };
  }
}
