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
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/auth/current-user.decorator.js';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator.js';
import type { RequestUser } from '../../../common/auth/request-user.js';
import { MANAGER_ROLES, Roles } from '../../../common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../../common/branch-scope/branch-scope.decorator.js';
import { ApiProblemResponses } from '../../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../../common/errors/validation.pipe.js';
import { Clock } from '../../../common/time/clock.js';
import { InjectAppConfig } from '../../../config/config.module.js';
import type { ServerConfig } from '../../../config/load-config.js';
import { AdminAuthService } from '../admin-auth.service.js';
import type { StaffRole } from '../admin-auth.service.js';
import { deviceLabelOf } from '../auth.service.js';
import {
  REFRESH_COOKIE_NAME,
  refreshCookieSecure,
  serializeRefreshCookie,
} from '../refresh-cookie.js';
import { MfaConfirmationDto, MfaRecoveryCodesDto } from './dto/mfa-confirmation.dto.js';
import { MfaCodeDto } from './dto/mfa-code.dto.js';
import { MfaSetupDto } from './dto/mfa-setup.dto.js';
import { CurrentMfaSubject, MfaAccessGuard } from './mfa-access.guard.js';
import type { MfaSubject } from './mfa-access.guard.js';
import { MfaService } from './mfa.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (decision 0007 section 2), as `BodyOf` in the auth controllers.
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
 * Skips the global `AuthGuard` (which accepts access tokens only) so that `MfaAccessGuard` can
 * also accept the enrolment token. Unlike `@Public()` it leaves the OpenAPI operation under the
 * document-wide bearer requirement: both tokens travel as `Authorization: Bearer`.
 */
function BearerCheckedByMfaGuard(): MethodDecorator {
  const skipGlobalAuthGuard = SetMetadata(IS_PUBLIC_KEY, true);
  const authenticate = UseGuards(MfaAccessGuard);
  return (target, key, descriptor) => {
    skipGlobalAuthGuard(target, key, descriptor);
    authenticate(target, key, descriptor);
  };
}

/**
 * The signed-in user's second factor (api-outline staff transport; A3-T2; decision 0008 section 8).
 * `MANAGER` and `ADMIN` only; `STAFF` cannot enrol (api-outline open item 2). The strict `auth`
 * throttler applies to `/api/v1/me/mfa/` by URL (10 per 5 minutes per IP, `throttle-profiles.ts`);
 * a wrong code counts toward the staff lockout.
 *
 * `setup` and `confirm` also accept the enrolment token of `MFA_REQUIRED`, which the global
 * `AuthGuard` refuses: `MfaAccessGuard` authenticates them instead, with the same `401` answers
 * (`BearerCheckedByMfaGuard`). `recovery-codes` needs a session (access token).
 */
@Controller('me/mfa')
export class MfaController {
  constructor(
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @InjectAppConfig() private readonly config: ServerConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * A new secret, pending until `confirm`: `200 { otpauthUri, secret }`, shown once. An enabled
   * second factor is never replaced here: `409 ALREADY_EXISTS`.
   */
  @Post('setup')
  @BearerCheckedByMfaGuard()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MfaSetupDto })
  @ApiProblemResponses(
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'ALREADY_EXISTS',
    'RATE_LIMITED',
  )
  async setup(@CurrentMfaSubject() subject: MfaSubject): Promise<MfaSetupDto> {
    const user = await this.mfa.requireMfaUser(subject.userId, refusalOf(subject));
    return this.mfa.setup(user);
  }

  /**
   * Confirms the pending secret with a current code and returns ten recovery codes, shown once.
   * With the enrolment token the sign-in completes: `session` and the `kd_refresh` cookie (decision
   * 0008 section 8). A wrong, replayed or locked-out code is `400 CODE_INVALID`.
   */
  @Post('confirm')
  @BearerCheckedByMfaGuard()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: MfaConfirmationDto,
    description: `With the enrolment token, also sets the ${REFRESH_COOKIE_NAME} cookie.`,
  })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'CODE_INVALID',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'ALREADY_EXISTS',
    'RATE_LIMITED',
  )
  async confirm(
    @CurrentMfaSubject() subject: MfaSubject,
    @Body(new BodyOf(MfaCodeDto)) body: MfaCodeDto,
    @Headers('x-client') client: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<MfaConfirmationDto> {
    const user = await this.mfa.requireMfaUser(subject.userId, refusalOf(subject));
    if (subject.via === 'session') {
      const { recoveryCodes } = await this.mfa.confirm(user, body.code, () =>
        Promise.resolve(undefined),
      );
      return { recoveryCodes: [...recoveryCodes] };
    }

    const { recoveryCodes, value: tokens } = await this.mfa.confirm(user, body.code, (em) =>
      this.auth.startSession(user, deviceLabelOf(undefined, client), em),
    );
    this.auth.logSignIn(user);
    const signIn = this.auth.signInOf(tokens, { ...user, role: user.role as StaffRole });
    response.setHeader(
      'Set-Cookie',
      serializeRefreshCookie(
        signIn.refreshToken,
        signIn.refreshTokenExpiresAt,
        this.clock.now(),
        refreshCookieSecure(this.config.appEnv),
      ),
    );
    return { recoveryCodes: [...recoveryCodes], session: signIn.session };
  }

  /**
   * Replaces the whole recovery set after a current TOTP code; the old codes stop working. No
   * confirmed second factor: `409 MFA_NOT_ENABLED`.
   */
  @Post('recovery-codes')
  @Roles(...MANAGER_ROLES)
  @NotBranchScoped("The caller's own second factor; reads no branch data.")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MfaRecoveryCodesDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'CODE_INVALID',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'MFA_NOT_ENABLED',
    'RATE_LIMITED',
  )
  async regenerateRecoveryCodes(
    @CurrentUser() current: RequestUser,
    @Body(new BodyOf(MfaCodeDto)) body: MfaCodeDto,
  ): Promise<MfaRecoveryCodesDto> {
    const user = await this.mfa.requireMfaUser(current.id, 'FORBIDDEN');
    return { recoveryCodes: [...(await this.mfa.regenerateRecoveryCodes(user, body.code))] };
  }
}

/** The enrolment token of an account that may no longer enrol is void (`401`); a session, `403`. */
function refusalOf(subject: MfaSubject): 'UNAUTHENTICATED' | 'FORBIDDEN' {
  return subject.via === 'enrolment' ? 'UNAUTHENTICATED' : 'FORBIDDEN';
}
