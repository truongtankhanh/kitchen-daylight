import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { Public } from '../../../common/auth/public.decorator.js';
import { ApiProblemResponses } from '../../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../../common/errors/validation.pipe.js';
import type { AuthSession } from '../auth.service.js';
import { AuthSessionDto } from '../dto/auth-session.dto.js';
import type { AuthProvider } from '../entities/auth-identity.entity.js';
import { SocialNonceDto } from './dto/social-nonce.dto.js';
import { SocialSignInDto } from './dto/social-sign-in.dto.js';
import { SocialService } from './social.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (decision 0007 section 2); the same small pipe as `BodyOf` in `auth.controller.ts`.
 */
class BodyOf implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * Social sign-in for customers on mobile (api-outline, "Authentication, customer transport";
 * ADR-0003; A2-T6). Every route is `@Public()`. The strict `auth` throttler applies by URL
 * (`throttle-profiles.ts`, decision 0008 section 7): sign-in 20 per 5 minutes, nonce 30 per 5
 * minutes per IP.
 */
@Controller('auth/social')
export class SocialController {
  constructor(@Inject(SocialService) private readonly social: SocialService) {}

  @Public()
  @Post('nonce')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SocialNonceDto })
  @ApiProblemResponses('RATE_LIMITED')
  issueNonce(): SocialNonceDto {
    return this.social.issueNonce();
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'ACCOUNT_SUSPENDED',
    'EMAIL_NOT_VERIFIED',
    'ALREADY_EXISTS',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  google(
    @Body(new BodyOf(SocialSignInDto)) body: SocialSignInDto,
    @Headers('x-client') client: string | undefined,
    @Headers('x-app-version') appVersion: string | undefined,
  ): Promise<AuthSession> {
    return this.signIn('GOOGLE', body, client, appVersion);
  }

  @Public()
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'ACCOUNT_SUSPENDED',
    'EMAIL_NOT_VERIFIED',
    'ALREADY_EXISTS',
    'NOT_FOUND',
    'RATE_LIMITED',
  )
  apple(
    @Body(new BodyOf(SocialSignInDto)) body: SocialSignInDto,
    @Headers('x-client') client: string | undefined,
    @Headers('x-app-version') appVersion: string | undefined,
  ): Promise<AuthSession> {
    return this.signIn('APPLE', body, client, appVersion);
  }

  private signIn(
    provider: AuthProvider,
    body: SocialSignInDto,
    client: string | undefined,
    appVersion: string | undefined,
  ): Promise<AuthSession> {
    return this.social.signIn(provider, body, { client, appVersion });
  }
}
