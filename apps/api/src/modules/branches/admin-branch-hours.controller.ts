import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { MANAGER_ROLES, Roles } from '../../common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../common/branch-scope/branch-scope.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { BranchHoursService } from './branch-hours.service.js';
import type { AdminBranchHoursView } from './branch-hours.service.js';
import {
  AdminBranchHoursDto,
  BranchHoursQueryDto,
  BranchHoursUpdateDto,
} from './dto/branch-hours.dto.js';

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

/** Same scoping as `/admin/branches/{id}` (api-divergences D-132, D-147). */
const SCOPED_IN_SERVICE =
  'Scoped in BranchHoursService through BranchScopeService (404 outside staff_branches); ' +
  'checked by branches-scoping.int-spec.ts (api-divergences D-132, D-147).';

/**
 * `/admin/branches/{id}/hours` (api-outline "Branches"; A5-T3). `MANAGER` on their own branches,
 * `ADMIN` on every branch; `STAFF` and customers get `403 FORBIDDEN` from `RolesGuard`.
 */
@Roles(...MANAGER_ROLES)
@Controller('admin/branches/:id/hours')
export class AdminBranchHoursController {
  constructor(@Inject(BranchHoursService) private readonly hours: BranchHoursService) {}

  /**
   * Weekly periods per service and a page of special days: from today on, plus the last 30 days
   * with `includePast=true` (brief C17).
   */
  @Get()
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: AdminBranchHoursDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  get(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ValidatedAs(BranchHoursQueryDto)) query: BranchHoursQueryDto,
  ): Promise<AdminBranchHoursView> {
    return this.hours.get(actor, id, query);
  }

  /**
   * Replaces the weekly periods and the special days that end today or later, with `rowVersion`.
   * `OVERLAP`, `EQUAL_TIMES`, `INVALID_TIME`, `RANGE_INVALID` per item (brief C14 to C16).
   */
  @Put()
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: AdminBranchHoursDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'STALE_VERSION',
    'RATE_LIMITED',
  )
  replace(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(BranchHoursUpdateDto)) body: BranchHoursUpdateDto,
  ): Promise<AdminBranchHoursView> {
    return this.hours.replace(actor, id, body);
  }
}
