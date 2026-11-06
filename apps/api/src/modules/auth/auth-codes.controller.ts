import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiAcceptedResponse, ApiNoContentResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { Public } from '../../common/auth/public.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SendEmailCodeDto } from './dto/send-email-code.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { EmailCodeService } from './email-code.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata, which the test transformer may not emit (decision 0007 section 2). The same small pipe
 * as in `auth.controller.ts`, where it is private; a shared copy belongs in `common/errors` once a
 * task may change that file.
 */
class BodyOf implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/**
 * Email codes of the customer transport (api-outline, "Authentication, customer transport"; A2-T2;
 * shapes in api-divergences D-051). The two email routes need a customer access token (the acting
 * user comes from it); the two password routes are public. Send routes answer `202` whatever
 * happened (decision 0008 section 5); verify and reset answer `204`. The strict `auth` throttler
 * applies by URL (`throttle-profiles.ts`: send-code and forgot 5, verify and reset 10, per 15
 * minutes per IP).
 */
@Controller('auth')
export class AuthCodesController {
  constructor(@Inject(EmailCodeService) private readonly codes: EmailCodeService) {}

  @Post('email/send-code')
  @Roles('CUSTOMER')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'The same answer whether or not a message was sent.' })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'INVALID_STATE',
    'RATE_LIMITED',
  )
  async sendCode(
    @CurrentUser() user: RequestUser,
    @Body(new BodyOf(SendEmailCodeDto)) body: SendEmailCodeDto,
  ): Promise<void> {
    await this.codes.sendVerificationCode(user.id, body.email);
  }

  @Post('email/verify')
  @Roles('CUSTOMER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN',
    'CODE_INVALID',
    'RATE_LIMITED',
  )
  async verifyEmail(
    @CurrentUser() user: RequestUser,
    @Body(new BodyOf(VerifyEmailDto)) body: VerifyEmailDto,
  ): Promise<void> {
    await this.codes.verifyEmail(user.id, body.code);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'The same answer whether or not the email has an account.' })
  @ApiProblemResponses('VALIDATION_FAILED', 'RATE_LIMITED')
  async forgotPassword(
    @Body(new BodyOf(ForgotPasswordDto)) body: ForgotPasswordDto,
  ): Promise<void> {
    await this.codes.forgotPassword(body.email);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiProblemResponses('VALIDATION_FAILED', 'CODE_INVALID', 'RATE_LIMITED')
  async resetPassword(@Body(new BodyOf(ResetPasswordDto)) body: ResetPasswordDto): Promise<void> {
    await this.codes.resetPassword(body.email, body.code, body.newPassword);
  }
}
