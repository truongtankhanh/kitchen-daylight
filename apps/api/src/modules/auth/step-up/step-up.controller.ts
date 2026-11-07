import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiHeader, ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../../common/auth/request-user.js';
import { Roles } from '../../../common/auth/roles.decorator.js';
import { ApiProblemResponses } from '../../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../../common/errors/validation.pipe.js';
import { Sensitive } from '../../../common/fresh-role/sensitive.decorator.js';
import { ADMIN_CLIENT_VALUE, CsrfGuard } from '../csrf.guard.js';
import { StepUpTokenDto } from './dto/step-up-token.dto.js';
import { StepUpDto } from './dto/step-up.dto.js';
import { StepUpService } from './step-up.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata (as in `AdminAuthController`; decision 0007 section 2).
 */
class BodyOf implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * `POST /admin/auth/step-up` (api-outline staff transport, brief L14, proposal; A3-T6). Unlike the
 * other `/admin/auth` routes it needs the access token: `ADMIN` only, the role and status re-read
 * from the database (`@Sensitive()`), and the CSRF check of every `POST /admin/auth/*` (decision
 * 0008 section 10). Throttled with the staff sign-in group (10 per 5 minutes per IP).
 */
@Roles('ADMIN')
@Sensitive()
@UseGuards(CsrfGuard)
@ApiHeader({
  name: 'X-Client',
  required: true,
  schema: { type: 'string', enum: [ADMIN_CLIENT_VALUE] },
})
@Controller('admin/auth')
export class StepUpController {
  constructor(@Inject(StepUpService) private readonly stepUps: StepUpService) {}

  /**
   * A current TOTP code (not a recovery code) and a `purpose`: `200` with a step-up token valid 5
   * minutes for that purpose. Wrong, replayed (a step already used, for example by
   * the sign-in a moment ago: wait for the next code) or locked-out code: `400 CODE_INVALID`,
   * counted toward the lockout. No confirmed second factor: `409 MFA_NOT_ENABLED`.
   */
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StepUpTokenDto })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'CODE_INVALID',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'MFA_NOT_ENABLED',
    'RATE_LIMITED',
  )
  async stepUp(
    @CurrentUser() actor: RequestUser,
    @Body(new BodyOf(StepUpDto)) body: StepUpDto,
  ): Promise<StepUpTokenDto> {
    const grant = await this.stepUps.grant(actor, body.code, body.purpose);
    return { stepUpToken: grant.stepUpToken, expiresAt: grant.expiresAt.toISOString() };
  }
}
