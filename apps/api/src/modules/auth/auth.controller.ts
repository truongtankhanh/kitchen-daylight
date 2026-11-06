import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { Public } from '../../common/auth/public.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { AuthService } from './auth.service.js';
import type { AuthSession } from './auth.service.js';
import { AuthSessionDto } from './dto/auth-session.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata, which the test transformer may not emit (decision 0007 section 2). Same options and
 * error shape as the global pipe; validating twice where the metadata exists is harmless.
 */
class BodyOf implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * Customer authentication, tokens in the body (api-outline, "Authentication, customer transport";
 * A2-T1). Every route but `logout-all` is `@Public()`. The strict `auth` throttler applies by URL
 * (`throttle-profiles.ts`, decision 0008 section 7); no decorator is needed here.
 */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiCreatedResponse({ type: AuthSessionDto })
  @ApiProblemResponses('VALIDATION_FAILED', 'ALREADY_EXISTS', 'RATE_LIMITED')
  register(
    @Body(new BodyOf(RegisterDto)) body: RegisterDto,
    @Headers('x-client') client: string | undefined,
    @Headers('x-app-version') appVersion: string | undefined,
  ): Promise<AuthSession> {
    return this.auth.register(body, { client, appVersion });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'INVALID_CREDENTIALS',
    'ACCOUNT_SUSPENDED',
    'RATE_LIMITED',
  )
  login(
    @Body(new BodyOf(LoginDto)) body: LoginDto,
    @Headers('x-client') client: string | undefined,
  ): Promise<AuthSession> {
    return this.auth.login(body, { client });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthSessionDto })
  @ApiProblemResponses('VALIDATION_FAILED', 'UNAUTHENTICATED', 'RATE_LIMITED')
  refresh(@Body(new BodyOf(RefreshTokenDto)) body: RefreshTokenDto): Promise<AuthSession> {
    return this.auth.refresh(body.refreshToken);
  }

  /** Public, so a client whose access token expired can still sign out; unknown token → `204`. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses('VALIDATION_FAILED', 'RATE_LIMITED')
  async logout(@Body(new BodyOf(RefreshTokenDto)) body: RefreshTokenDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  /** Signs the caller out of every device: every refresh-token family of the token's user. */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses('UNAUTHENTICATED', 'TOKEN_EXPIRED', 'RATE_LIMITED')
  async logoutAll(@CurrentUser() user: RequestUser): Promise<void> {
    await this.auth.logoutAll(user.id);
  }
}
