import type { ServerResponse } from 'node:http';

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiHeader, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';

import { Public } from '../../common/auth/public.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { Clock } from '../../common/time/clock.js';
import { InjectAppConfig } from '../../config/config.module.js';
import type { ServerConfig } from '../../config/load-config.js';
import { AdminAuthService } from './admin-auth.service.js';
import type { AdminSession, AdminSignIn } from './admin-auth.service.js';
import { ADMIN_CLIENT_VALUE, CsrfGuard } from './csrf.guard.js';
import { AdminSessionDto } from './dto/admin-session.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AdminMfaSessionDto } from './mfa/dto/admin-mfa-session.dto.js';
import { MfaVerifyDto } from './mfa/dto/mfa-verify.dto.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  refreshCookieSecure,
  serializeRefreshCookie,
} from './refresh-cookie.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (as in `AuthController`; decision 0007 section 2).
 */
class BodyOf implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/** The part of the Node response the controller writes: the `Set-Cookie` header only. */
type CookieResponse = Pick<ServerResponse, 'setHeader'>;

/**
 * Staff authentication, refresh token in the `kd_refresh` cookie (api-outline, "Authentication,
 * staff transport"; A3-T1). Every route is `@Public()` and behind `CsrfGuard` (`X-Client:
 * admin-web` and an allowed `Origin`, decision 0008 section 10). The strict `auth` throttler
 * applies by URL (`throttle-profiles.ts`: login 10, refresh 60, logout 30 per 5 minutes per IP);
 * the per-account lockout is in `AdminAuthService`.
 *
 * Maintenance (A4-T3): the gate must keep `/api/v1/admin/auth/*` open, so that an admin can sign in
 * and switch maintenance off (api-outline, Conventions "Maintenance"; brief E18, L13).
 */
@Public()
@UseGuards(CsrfGuard)
@ApiHeader({
  name: 'X-Client',
  required: true,
  schema: { type: 'string', enum: [ADMIN_CLIENT_VALUE] },
})
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @InjectAppConfig() private readonly config: ServerConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * `STAFF`: `200 AdminSession` and the cookie. `MANAGER` and `ADMIN`: `403 MFA_REQUIRED` with
   * `mfaToken`, `mfaEnrolled` and `expiresIn` (api-divergences D-076), no cookie. Unknown email,
   * wrong password, locked, `INVITED`, `DELETED`, no password and a customer account: the same
   * `401 INVALID_CREDENTIALS`; `ACCOUNT_SUSPENDED` only after the right password.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminSessionDto, description: `Sets the ${REFRESH_COOKIE_NAME} cookie.` })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'INVALID_CREDENTIALS',
    'ACCOUNT_SUSPENDED',
    'MFA_REQUIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  async login(
    @Body(new BodyOf(LoginDto)) body: LoginDto,
    @Headers('x-client') client: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AdminSession> {
    const signIn = await this.auth.login(body, { client });
    return this.withCookie(signIn, response);
  }

  /**
   * The second step of a `MANAGER` or `ADMIN` (A3-T2): the challenge (`mfaToken` of
   * `MFA_REQUIRED`) with a TOTP `code` or one `recoveryCode`. Success: `200` with the session and
   * `recoveryCodesLeft`, and the cookie. Invalid or expired challenge, or an account that may no
   * longer sign in: `401 UNAUTHENTICATED`. Wrong, replayed or locked-out code: `400 CODE_INVALID`
   * (counted toward the lockout; brief E15).
   */
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: AdminMfaSessionDto,
    description: `Sets the ${REFRESH_COOKIE_NAME} cookie.`,
  })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'CODE_INVALID',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'RATE_LIMITED',
  )
  async verifyMfa(
    @Body(new BodyOf(MfaVerifyDto)) body: MfaVerifyDto,
    @Headers('x-client') client: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AdminMfaSessionDto> {
    const signIn = await this.auth.verifySecondStep(body, { client });
    return { ...this.withCookie(signIn, response), recoveryCodesLeft: signIn.recoveryCodesLeft };
  }

  /**
   * Rotates the cookie (reuse detection, 10-second grace window). Any failure answers
   * `401 UNAUTHENTICATED` and clears the cookie.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: AdminSessionDto,
    description: `Replaces the ${REFRESH_COOKIE_NAME} cookie.`,
  })
  @ApiProblemResponses('UNAUTHENTICATED', 'FORBIDDEN', 'RATE_LIMITED')
  async refresh(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AdminSession> {
    try {
      const signIn = await this.auth.refresh(readRefreshCookie(cookie));
      return this.withCookie(signIn, response);
    } catch (error) {
      response.setHeader('Set-Cookie', clearRefreshCookie(this.secure()));
      throw error;
    }
  }

  /** Revokes the cookie's family and clears the cookie; `204` whether or not a session existed. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: `Clears the ${REFRESH_COOKIE_NAME} cookie.` })
  @ApiProblemResponses('FORBIDDEN', 'RATE_LIMITED')
  async logout(
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    response.setHeader('Set-Cookie', clearRefreshCookie(this.secure()));
    await this.auth.logout(readRefreshCookie(cookie));
  }

  private withCookie(signIn: AdminSignIn, response: CookieResponse): AdminSession {
    response.setHeader(
      'Set-Cookie',
      serializeRefreshCookie(
        signIn.refreshToken,
        signIn.refreshTokenExpiresAt,
        this.clock.now(),
        this.secure(),
      ),
    );
    return signIn.session;
  }

  private secure(): boolean {
    return refreshCookieSecure(this.config.appEnv);
  }
}
