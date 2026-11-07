import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

import { STEP_UP_PURPOSE_KEY, StepUpGuard } from './step-up.guard.js';
import { isStepUpPurpose } from './step-up.service.js';
import type { StepUpPurpose } from './step-up.service.js';

/**
 * Requires a step-up token for `purpose` in the `X-Step-Up-Token` header (`StepUpGuard`; A3-T6),
 * obtained from `POST /admin/auth/step-up`. A4-T2 applies it to the `PUT` of the `payment` settings
 * key with `settings.payment`. Use it with `@Roles('ADMIN')` and `@Sensitive()`.
 */
export function RequiresStepUp(purpose: StepUpPurpose): ClassDecorator & MethodDecorator {
  if (!isStepUpPurpose(purpose)) {
    throw new Error('@RequiresStepUp() needs a purpose of STEP_UP_PURPOSES.');
  }
  return applyDecorators(
    SetMetadata(STEP_UP_PURPOSE_KEY, purpose),
    UseGuards(StepUpGuard),
    ApiHeader({
      name: 'X-Step-Up-Token',
      required: true,
      description: `A step-up token for \`${purpose}\` from POST /api/v1/admin/auth/step-up.`,
    }),
  );
}
