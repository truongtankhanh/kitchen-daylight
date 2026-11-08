import type { IncomingHttpHeaders } from 'node:http';

import { Body, Controller, Get, Headers, Inject, Put } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiExtraModels, ApiHeader, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { Sensitive } from '../../common/fresh-role/sensitive.decorator.js';
import { stepUpTokenOf } from '../auth/step-up/step-up.guard.js';
import { AdminSettingsService } from './admin-settings.service.js';
import type { AdminAppSettingsView, SavedSettingView } from './admin-settings.service.js';
import {
  AdminAppSettingsDto,
  AppSettingSaveDto,
  AppSettingSavedDto,
} from './dto/admin-app-settings.dto.js';
import { SETTING_VALUE_DTOS } from './dto/setting-values.dto.js';

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
 * `GET, PUT /admin/app-settings` (api-outline "Users and operations"; brief L1, L2, L10, L14; A4-T2).
 * `ADMIN` only, the role and status re-read on every request (`@Sensitive()`). No branch marker:
 * an `ADMIN`-only route is not branch-scoped (A3-T5). The acting admin comes from the token.
 */
@Roles('ADMIN')
@Sensitive()
@ApiExtraModels(...SETTING_VALUE_DTOS)
@Controller('admin/app-settings')
export class AdminSettingsController {
  constructor(@Inject(AdminSettingsService) private readonly settings: AdminSettingsService) {}

  /** Every key as `{ value, rowVersion, updatedBy, updatedAt }`, plus read-only `security`. */
  @Get()
  @ApiOkResponse({ type: AdminAppSettingsDto })
  @ApiProblemResponses('UNAUTHENTICATED', 'TOKEN_EXPIRED', 'FORBIDDEN', 'RATE_LIMITED')
  read(): Promise<AdminAppSettingsView> {
    return this.settings.readAll();
  }

  /**
   * Saves one key. A stale `rowVersion` is `409 STALE_VERSION` with `current { rowVersion,
   * updatedBy, updatedAt, value }` (a `payment` value shows only `accountNumberLast5`). Field errors
   * carry the full camelCase path, for example `ordering.boardThresholds.accept.warn`. The
   * `payment` key also needs `X-Step-Up-Token` for `settings.payment` (`403 FORBIDDEN` without it),
   * and the other admins are emailed after the save.
   */
  @Put()
  @ApiHeader({
    name: 'X-Step-Up-Token',
    required: false,
    description:
      'Required when `key` is `payment`: a step-up token for `settings.payment` from POST /api/v1/admin/auth/step-up.',
  })
  @ApiOkResponse({ type: AppSettingSavedDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'STALE_VERSION',
    'RATE_LIMITED',
  )
  save(
    @CurrentUser() actor: RequestUser,
    @Body(new ValidatedAs(AppSettingSaveDto)) body: AppSettingSaveDto,
    @Headers() headers: IncomingHttpHeaders,
  ): Promise<SavedSettingView> {
    return this.settings.save(
      actor,
      { key: body.key, value: body.value, rowVersion: body.rowVersion },
      stepUpTokenOf(headers),
    );
  }
}
