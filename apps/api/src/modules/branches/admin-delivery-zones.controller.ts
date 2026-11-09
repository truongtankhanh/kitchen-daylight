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
import { DeliveryZonesService } from './delivery-zones.service.js';
import type {
  AdminDeliveryZoneListView,
  AdminDeliveryZoneView,
  DeliveryZoneCheckView,
} from './delivery-zones.service.js';
import { AdminBranchDeleteQueryDto } from './dto/admin-branches-query.dto.js';
import {
  AdminDeliveryZoneCreateDto,
  AdminDeliveryZoneDto,
  AdminDeliveryZoneListDto,
  AdminDeliveryZoneUpdateDto,
  DeliveryZoneCheckDto,
  DeliveryZoneCheckResultDto,
} from './dto/delivery-zone.dto.js';

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

/** Same scoping as `/admin/branches/{id}` (api-divergences D-132). */
const SCOPED_IN_SERVICE =
  'Scoped in DeliveryZonesService through BranchScopeService (404 outside staff_branches); ' +
  'moves to @BranchScoped in A5-T6 (api-divergences D-132).';

/**
 * `/admin/branches/{id}/delivery-zones` (api-outline "Branches"; A5-T4). The rings are `MANAGER`
 * on their own branches and `ADMIN` on every branch; the zone check is also open to `STAFF` of the
 * branch. Anyone else gets `403 FORBIDDEN` from `RolesGuard`.
 */
@Roles(...MANAGER_ROLES)
@Controller('admin/branches/:id/delivery-zones')
export class AdminDeliveryZonesController {
  constructor(@Inject(DeliveryZonesService) private readonly zones: DeliveryZonesService) {}

  /** Every ring, active or not, ordered by radius, with `total` (brief C27: no cap). */
  @Get()
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: AdminDeliveryZoneListDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  list(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminDeliveryZoneListView> {
    return this.zones.list(actor, id);
  }

  /** A new ring, larger than the outermost one (`RADIUS_ORDER`, brief C19). */
  @Post()
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiCreatedResponse({ type: AdminDeliveryZoneDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  create(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AdminDeliveryZoneCreateDto)) body: AdminDeliveryZoneCreateDto,
  ): Promise<AdminDeliveryZoneView> {
    return this.zones.create(actor, id, body);
  }

  /**
   * The ring that serves a point: `{ distanceM, zone, outOfZone }` (brief C24). The coordinates
   * are not stored, logged or echoed.
   */
  @Post('check')
  @HttpCode(HttpStatus.OK)
  @Roles(...STAFF_ROLES)
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: DeliveryZoneCheckResultDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  check(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(DeliveryZoneCheckDto)) body: DeliveryZoneCheckDto,
  ): Promise<DeliveryZoneCheckView> {
    return this.zones.check(actor, id, body.location);
  }

  /**
   * A partial change with the zone `rowVersion`. `RADIUS_ORDER` (C19), `LAST_ACTIVE_ZONE` on
   * `isActive` (C21).
   */
  @Patch(':zoneId')
  @NotBranchScoped(SCOPED_IN_SERVICE)
  @ApiOkResponse({ type: AdminDeliveryZoneDto })
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
    @Param('zoneId', new ParseUUIDPipe()) zoneId: string,
    @Body(new ValidatedAs(AdminDeliveryZoneUpdateDto)) body: AdminDeliveryZoneUpdateDto,
  ): Promise<AdminDeliveryZoneView> {
    return this.zones.update(actor, id, zoneId, body);
  }

  /**
   * Hard delete. `LAST_ACTIVE_ZONE` on `id` (C21); `IN_USE` with `usage` once orders reference the
   * zone, "stop using" being `isActive: false` (C22).
   */
  @Delete(':zoneId')
  @NotBranchScoped(SCOPED_IN_SERVICE)
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
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('zoneId', new ParseUUIDPipe()) zoneId: string,
    @Query(new ValidatedAs(AdminBranchDeleteQueryDto)) query: AdminBranchDeleteQueryDto,
  ): Promise<void> {
    await this.zones.remove(actor, id, zoneId, query.rowVersion);
  }
}
