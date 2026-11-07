import type { IncomingHttpHeaders } from 'node:http';

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { GuardedRequest } from '../../../common/auth/request-user.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { StepUpService } from './step-up.service.js';
import type { StepUpPurpose } from './step-up.service.js';

export const STEP_UP_PURPOSE_KEY = 'kd:auth:step-up-purpose';

/**
 * The request header that carries the step-up token (api-divergences D-100: the outline says
 * neither header nor body). A header keeps the token out of the body that the route validates and
 * audits, and out of URLs and access logs (the request serializer logs no header values).
 */
export const STEP_UP_HEADER = 'x-step-up-token';

/** A bound on the header before any verification; a real token is about 400 characters. */
export const STEP_UP_HEADER_MAX_LENGTH = 2048;

/** The token of the header, or `undefined` when it is missing, repeated, empty or too long. */
export function stepUpTokenOf(headers: IncomingHttpHeaders): string | undefined {
  const value = headers[STEP_UP_HEADER];
  if (typeof value !== 'string') {
    return undefined;
  }
  const token = value.trim();
  return token === '' || token.length > STEP_UP_HEADER_MAX_LENGTH ? undefined : token;
}

/**
 * The guard of `@RequiresStepUp(purpose)` (A3-T6). Runs after the global guards, so the request
 * user comes from a verified access token. The `X-Step-Up-Token` header must hold a step-up token
 * (`typ: step-up+jwt`, the step-up audience: an access token never passes) that is authentic,
 * unexpired, of the same user as the access token and for the route's purpose; otherwise
 * `403 FORBIDDEN`, with no hint of which check failed. The token is never logged.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(StepUpService) private readonly stepUps: StepUpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const purpose = this.reflector.getAllAndOverride<StepUpPurpose | undefined>(
      STEP_UP_PURPOSE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (purpose === undefined) {
      return true;
    }
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    if (request.user === undefined) {
      throw new ApiError('UNAUTHENTICATED');
    }
    const token = stepUpTokenOf(request.headers);
    if (token === undefined || !(await this.stepUps.verify(token, request.user.id, purpose))) {
      throw new ApiError('FORBIDDEN');
    }
    return true;
  }
}
