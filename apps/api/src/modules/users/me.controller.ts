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
import { ApiNoContentResponse, ApiOkResponse, ApiParam } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { ApiError } from '../../common/errors/api-error.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { AUTH_PROVIDERS } from '../auth/entities/auth-identity.entity.js';
import type { AuthProvider } from '../auth/entities/auth-identity.entity.js';
import { LinkSocialIdentityDto } from '../auth/social/dto/social-sign-in.dto.js';
import { SocialService } from '../auth/social/social.service.js';
import { MeConsentDto } from './dto/me-consent.dto.js';
import { MePasswordDto } from './dto/me-password.dto.js';
import { MeSessionPageDto } from './dto/me-session.dto.js';
import { MeSessionsQueryDto } from './dto/me-sessions-query.dto.js';
import { MeUpdateDto } from './dto/me-update.dto.js';
import { MeDto } from './dto/me.dto.js';
import { MeService } from './me.service.js';
import { SessionsService } from './sessions.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata, which the test transformer may not emit (decision 0007 section 2). The same small pipe
 * as `BodyOf` in the auth controllers and `ValidatedAs` in `geo.controller.ts`; a shared copy
 * belongs in `common/errors` once a task may change that file.
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * The `{provider}` path parameter: `GOOGLE` or `APPLE`, exactly; anything else is
 * `VALIDATION_FAILED` with `INVALID` on `provider`.
 */
class ProviderParam implements PipeTransform<unknown, AuthProvider> {
  transform(value: unknown): AuthProvider {
    const provider = AUTH_PROVIDERS.find((known) => known === value);
    if (provider === undefined) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [{ field: 'provider', code: 'INVALID', message: 'must be GOOGLE or APPLE' }],
      });
    }
    return provider;
  }
}

/**
 * The signed-in user's own account (api-outline "Current user"; A2-T4). Every route needs an access
 * token and no `@Roles`: any signed-in user. The acting user, and for the password change and the
 * session list the current session, come from the token only (`@CurrentUser()`); no body, path or
 * query names a user. `DELETE /me` is A11-T4. `/me/identities/{provider}` (A2-T6) uses
 * `SocialService` from the global `AuthModule`; the strict `auth` throttler applies to it by URL
 * (`throttle-profiles.ts`).
 */
@Controller('me')
export class MeController {
  constructor(
    @Inject(MeService) private readonly me: MeService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(SocialService) private readonly social: SocialService,
  ) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  @ApiProblemResponses('UNAUTHENTICATED', 'TOKEN_EXPIRED', 'RATE_LIMITED')
  getProfile(@CurrentUser() user: RequestUser): Promise<MeDto> {
    return this.me.getProfile(user.id);
  }

  @Patch()
  @ApiOkResponse({ type: MeDto })
  @ApiProblemResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'RATE_LIMITED')
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Body(new ValidatedAs(MeUpdateDto)) body: MeUpdateDto,
  ): Promise<MeDto> {
    return this.me.updateProfile(user.id, body);
  }

  /** Keeps the current session; every other session of the user is signed out. */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'INVALID_CREDENTIALS',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'INVALID_STATE',
    'RATE_LIMITED',
  )
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ValidatedAs(MePasswordDto)) body: MePasswordDto,
  ): Promise<void> {
    await this.me.changePassword(user, body.currentPassword, body.newPassword);
  }

  @Get('consents')
  @ApiOkResponse({ type: MeConsentDto, isArray: true })
  @ApiProblemResponses('UNAUTHENTICATED', 'TOKEN_EXPIRED', 'RATE_LIMITED')
  listConsents(@CurrentUser() user: RequestUser): Promise<MeConsentDto[]> {
    return this.me.listConsents(user.id);
  }

  @Get('sessions')
  @ApiOkResponse({ type: MeSessionPageDto })
  @ApiProblemResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'RATE_LIMITED')
  listSessions(
    @CurrentUser() user: RequestUser,
    @Query(new ValidatedAs(MeSessionsQueryDto)) query: MeSessionsQueryDto,
  ): Promise<MeSessionPageDto> {
    return this.sessions.list(user, query);
  }

  /** Signs one device out. Revoking the current session ends it at the next refresh. */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  async revokeSession(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.sessions.revoke(user.id, id);
  }

  /**
   * Links a Google or Apple account (`{ idToken, nonce }` from the native flow and
   * `POST /auth/social/nonce`). Customers only; linking the same account again is a no-op.
   */
  @Post('identities/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'provider', enum: AUTH_PROVIDERS })
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'ALREADY_EXISTS',
    'RATE_LIMITED',
  )
  async linkIdentity(
    @CurrentUser() user: RequestUser,
    @Param('provider', new ProviderParam()) provider: AuthProvider,
    @Body(new ValidatedAs(LinkSocialIdentityDto)) body: LinkSocialIdentityDto,
  ): Promise<void> {
    await this.social.linkIdentity(user, provider, body);
  }

  /** Unlinks; refused with `INVALID_STATE` when no password and no other identity would be left. */
  @Delete('identities/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'provider', enum: AUTH_PROVIDERS })
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'NOT_FOUND',
    'INVALID_STATE',
    'RATE_LIMITED',
  )
  async unlinkIdentity(
    @CurrentUser() user: RequestUser,
    @Param('provider', new ProviderParam()) provider: AuthProvider,
  ): Promise<void> {
    await this.social.unlinkIdentity(user, provider);
  }
}
