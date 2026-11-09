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
import { MANAGER_ROLES, Roles, STAFF_ROLES } from '../../common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../common/branch-scope/branch-scope.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { BranchPauseService } from './branch-pause.service.js';
import type { BranchPauseView } from './branch-pause.service.js';
import { BranchesService } from './branches.service.js';
import type { AdminBranchDetailView, AdminBranchPage } from './branches.service.js';
import { AdminBranchCreateDto, AdminBranchUpdateDto } from './dto/admin-branch-input.dto.js';
import { AdminBranchDetailDto, AdminBranchPageDto } from './dto/admin-branch.dto.js';
import {
  AdminBranchDeleteQueryDto,
  AdminBranchesQueryDto,
} from './dto/admin-branches-query.dto.js';
import { BranchPauseResultDto, PauseBranchDto } from './dto/pause-branch.dto.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (as `ValidatedAs` in `admin-users.controller.ts`; decision 0007 section 2).
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * The reason of the manager routes: `BranchesService` scopes them through `BranchScopeService`
 * (an id outside the caller's `staff_branches` is `404`). A5-T6 moves them to `@BranchScoped`
 * when the enumerating harness accepts manager-only routes (api-divergences D-132).
 */
const SCOPED_IN_SERVICE =
  'Scoped in BranchesService through BranchScopeService (404 outside staff_branches); ' +
  'moves to @BranchScoped in A5-T6 (api-divergences D-132).';

/**
 * `/admin/branches` (api-outline "Branches"; A5-T2). `MANAGER` reads and edits their own branches,
 * `ADMIN` every branch; create and delete are `ADMIN` only. `STAFF` may only use the pause switch
 * (A5-T5) on their own branches; customers get `403 FORBIDDEN` from `RolesGuard`. The acting user
 * comes from the access token only.
 */
@Roles(...MANAGER_ROLES)
@Controller('admin/branches')
export class AdminBranchesController {
  constructor(
    @Inject(BranchesService) private readonly branches: BranchesService,
    @Inject(BranchPauseService) private readonly pauses: BranchPauseService,
  ) {}

  /** The caller's branches, with the figures of the list (brief C2, C4). */
  @Get()
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: AdminBranchPageDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  list(
    @CurrentUser() actor: RequestUser,
    @Query(new ValidatedAs(AdminBranchesQueryDto)) query: AdminBranchesQueryDto,
  ): Promise<AdminBranchPage> {
    return this.branches.list(actor, query);
  }

  /** A new branch; delivery stays off until a zone exists (brief C8). */
  @Post()
  @Roles('ADMIN')
  @ApiCreatedResponse({ type: AdminBranchDetailDto })
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
    @Body(new ValidatedAs(AdminBranchCreateDto)) body: AdminBranchCreateDto,
  ): Promise<AdminBranchDetailView> {
    return this.branches.create(actor, body);
  }

  /** One branch with `rowVersion`, services, reservation rules and amenities. */
  @Get(':id')
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: AdminBranchDetailDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  detail(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminBranchDetailView> {
    return this.branches.detail(actor, id);
  }

  /**
   * A partial change with `rowVersion`. `LOCKED` on `code` once an order exists (C6);
   * `acceptsDelivery` needs an active zone (C8); `location` confirms the pin (C9).
   */
  @Patch(':id')
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: AdminBranchDetailDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'STALE_VERSION',
    'ALREADY_EXISTS',
    'RATE_LIMITED',
  )
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AdminBranchUpdateDto)) body: AdminBranchUpdateDto,
  ): Promise<AdminBranchDetailView> {
    return this.branches.update(actor, id, body);
  }

  /**
   * The staff "pause orders" switch: `{ paused }` moves `status` between `ACTIVE` and
   * `TEMPORARILY_CLOSED` only; a `CLOSED` branch is `INVALID_STATE` for every role. Asking for the
   * state the branch has answers `200` and writes nothing. Audited (`branch.pause`); emits
   * `branch.updated`. Orders in progress are not affected.
   */
  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @Roles(...STAFF_ROLES)
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: BranchPauseResultDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'INVALID_STATE',
    'RATE_LIMITED',
  )
  pause(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(PauseBranchDto)) body: PauseBranchDto,
  ): Promise<BranchPauseView> {
    return this.pauses.setPaused(actor, id, body.paused);
  }

  /**
   * Soft delete. `HAS_ACTIVE_ORDERS` with `details { orders, reservations }` while work is open
   * (C1); `INVALID_STATE` for the last branch in operation.
   */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'STALE_VERSION',
    'HAS_ACTIVE_ORDERS',
    'INVALID_STATE',
    'RATE_LIMITED',
  )
  async remove(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ValidatedAs(AdminBranchDeleteQueryDto)) query: AdminBranchDeleteQueryDto,
  ): Promise<void> {
    await this.branches.remove(actor, id, query.rowVersion);
  }
}
