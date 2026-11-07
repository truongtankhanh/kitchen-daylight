import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiAcceptedResponse, ApiHeader, ApiNoContentResponse } from '@nestjs/swagger';

import { Public } from '../../common/auth/public.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { ADMIN_CLIENT_VALUE, CsrfGuard } from './csrf.guard.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { SetPasswordDto } from './dto/set-password.dto.js';
import { StaffLinkService } from './staff-link.service.js';

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
 * Staff invitation and password links (api-outline, "Authentication, staff transport"; A3-T3;
 * shapes in api-divergences D-085). Public and behind `CsrfGuard`, like every `POST
 * /admin/auth/*`. The strict `auth` throttler applies by URL (`throttle-profiles.ts`: forgot 5,
 * set 10, per 15 minutes per IP); the per-account rules (60 s, 5 per 24 h) are in
 * `StaffLinkService`. Neither route signs the user in.
 */
@Public()
@UseGuards(CsrfGuard)
@ApiHeader({
  name: 'X-Client',
  required: true,
  schema: { type: 'string', enum: [ADMIN_CLIENT_VALUE] },
})
@Controller('admin/auth/password')
export class AdminPasswordController {
  constructor(@Inject(StaffLinkService) private readonly links: StaffLinkService) {}

  /**
   * `202` whatever happened: a reset link to an `ACTIVE` staff account, a fresh invitation to an
   * `INVITED` one, nothing otherwise (decision 0008 section 5; api-divergences D-084).
   */
  @Post('forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'The same answer whether or not the email has an account.' })
  @ApiProblemResponses('VALIDATION_FAILED', 'FORBIDDEN', 'RATE_LIMITED')
  async forgotPassword(
    @Body(new BodyOf(ForgotPasswordDto)) body: ForgotPasswordDto,
  ): Promise<void> {
    await this.links.forgotPassword(body.email);
  }

  /** Sets the password from an invitation or reset link; `CODE_INVALID` for any dead link. */
  @Post('set')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses('VALIDATION_FAILED', 'CODE_INVALID', 'FORBIDDEN', 'RATE_LIMITED')
  async setPassword(@Body(new BodyOf(SetPasswordDto)) body: SetPasswordDto): Promise<void> {
    await this.links.setPassword(body.token, body.password);
  }
}
