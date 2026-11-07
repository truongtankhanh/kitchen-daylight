import type { ServerResponse } from 'node:http';

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { ApiError } from '../../common/errors/api-error.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { AdminUsersService } from './admin-users.service.js';
import type { AdminStaffUserView, AdminUserView, LinkSendResult } from './admin-users.service.js';
import { AdminUserCreateDto, AdminUserUpdateDto } from './dto/admin-user-input.dto.js';
import {
  AdminCustomerUserDto,
  AdminStaffUserDto,
  AdminUserContactDto,
  AdminUserPageDto,
} from './dto/admin-user.dto.js';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (as `ValidatedAs` in `me.controller.ts`; decision 0007 section 2).
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/** The part of the Node response a rate-limited answer writes: `Retry-After` only. */
type HeaderResponse = Pick<ServerResponse, 'setHeader'>;

/**
 * `429 RATE_LIMITED` with `Retry-After` for a link sent again within 60 s (brief E10) or beyond 5
 * links in 24 hours (decision 0008 section 6; api-divergences D-088).
 */
function throwIfTooSoon(result: LinkSendResult, response: HeaderResponse): void {
  if (!result.sent) {
    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new ApiError('RATE_LIMITED', {
      detail:
        result.reason === 'DAILY_CAP'
          ? 'This person already received 5 links in the last 24 hours.'
          : 'A link was sent to this person less than 60 s ago.',
    });
  }
}

const USER_ITEM_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(AdminStaffUserDto) },
    { $ref: getSchemaPath(AdminCustomerUserDto) },
  ],
};

/**
 * Staff and customer accounts (api-outline "Users and operations"; A3-T4). `ADMIN` only, from the
 * role of the access token (`RolesGuard`; the fresh-role guard is A3-T6). The acting admin comes
 * from the token. Branch scoping does not apply: user actions are admin only (A3-T5).
 */
@Roles('ADMIN')
@ApiExtraModels(AdminStaffUserDto, AdminCustomerUserDto)
@Controller('admin/users')
export class AdminUsersController {
  constructor(@Inject(AdminUsersService) private readonly users: AdminUsersService) {}

  /** Staff in full, customers with a masked contact (brief E2, E12, E14, M19). */
  @Get()
  @ApiOkResponse({ type: AdminUserPageDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  list(
    @Query(new ValidatedAs(AdminUsersQueryDto)) query: AdminUsersQueryDto,
  ): Promise<AdminUserPageDto> {
    return this.users.list(query) as Promise<AdminUserPageDto>;
  }

  /** An `INVITED` staff account and its invitation link (brief E1). */
  @Post()
  @ApiCreatedResponse({ type: AdminStaffUserDto })
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
    @Body(new ValidatedAs(AdminUserCreateDto)) body: AdminUserCreateDto,
  ): Promise<AdminStaffUserView> {
    return this.users.create(actor, body);
  }

  /**
   * `displayName`, `role`, `status`, `branchIds` (a customer: `status` only). `SELF_CHANGE`,
   * `LAST_ADMIN`; a role change or a suspension ends the person's sessions (brief E6).
   */
  @Patch(':id')
  @ApiOkResponse({ schema: USER_ITEM_SCHEMA })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'SELF_CHANGE',
    'NOT_FOUND',
    'LAST_ADMIN',
    'INVALID_STATE',
    'INVALID_TRANSITION',
    'RATE_LIMITED',
  )
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidatedAs(AdminUserUpdateDto)) body: AdminUserUpdateDto,
  ): Promise<AdminUserView> {
    return this.users.update(actor, id, body);
  }

  /** A 30-minute reset link to an `ACTIVE` staff account; `INVALID_STATE` when invited (E7). */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'INVALID_STATE',
    'RATE_LIMITED',
  )
  async resetPassword(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<void> {
    throwIfTooSoon(await this.users.sendPasswordReset(actor, id), response);
  }

  /** A new 48-hour invitation link that expires the old one; once per 60 s (E10). */
  @Post(':id/resend-invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'INVALID_STATE',
    'RATE_LIMITED',
  )
  async resendInvite(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<void> {
    throwIfTooSoon(await this.users.resendInvite(actor, id), response);
  }

  /** Deletes the second factor of another user and ends their sessions (E9; WA20). */
  @Post(':id/mfa-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'SELF_CHANGE',
    'NOT_FOUND',
    'MFA_NOT_ENABLED',
    'RATE_LIMITED',
  )
  async resetMfa(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.users.resetMfa(actor, id);
  }

  /** The full email and phone; writes `order.contact_reveal` with entity `USER` (E13). */
  @Post(':id/reveal-contact')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminUserContactDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  revealContact(
    @CurrentUser() actor: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminUserContactDto> {
    return this.users.revealContact(actor, id);
  }
}
