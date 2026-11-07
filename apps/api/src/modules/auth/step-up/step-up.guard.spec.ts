import { Controller, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { httpContext, requestOn } from '../../../common/auth/testing.js';
import type { GuardedRequest } from '../../../common/auth/request-user.js';
import { RequiresStepUp } from './requires-step-up.decorator.js';
import { STEP_UP_HEADER_MAX_LENGTH, StepUpGuard, stepUpTokenOf } from './step-up.guard.js';
import type { StepUpPurpose, StepUpService } from './step-up.service.js';

const USER_ID = '01930000-0000-7000-8000-00000000c2a1';
const SESSION_ID = '01930000-0000-7000-8000-00000000c2b1';
const TOKEN = 'header.payload.signature';

@Controller('admin/things')
class ThingsController {
  @RequiresStepUp('settings.payment')
  @Post('payment')
  payment(): void {}

  @Post('plain')
  plain(): void {}
}

const PROTECTED = { controller: ThingsController, handler: ThingsController.prototype.payment };
const PLAIN = { controller: ThingsController, handler: ThingsController.prototype.plain };

interface VerifyCall {
  readonly token: string;
  readonly userId: string;
  readonly purpose: StepUpPurpose;
}

function guardWith(valid: boolean): { guard: StepUpGuard; calls: VerifyCall[] } {
  const calls: VerifyCall[] = [];
  const stepUps = {
    verify: (token: string, userId: string, purpose: StepUpPurpose) => {
      calls.push({ token, userId, purpose });
      return Promise.resolve(valid);
    },
  } as unknown as StepUpService;
  return { guard: new StepUpGuard(new Reflector(), stepUps), calls };
}

function signedIn(headers: Record<string, string | string[]> = {}): GuardedRequest {
  return requestOn('/api/v1/admin/things/payment', {
    headers,
    user: { id: USER_ID, role: 'ADMIN', sessionId: SESSION_ID },
  });
}

describe('stepUpTokenOf', () => {
  it('reads and trims the header', () => {
    expect(stepUpTokenOf({ 'x-step-up-token': ` ${TOKEN} ` })).toBe(TOKEN);
  });

  it.each([
    ['missing', {}],
    ['empty', { 'x-step-up-token': '  ' }],
    ['too long', { 'x-step-up-token': 'a'.repeat(STEP_UP_HEADER_MAX_LENGTH + 1) }],
  ])('refuses a %s header', (_case, headers) => {
    expect(stepUpTokenOf(headers)).toBeUndefined();
  });
});

describe('StepUpGuard', () => {
  it('checks the token against the request user and the route purpose', async () => {
    const { guard, calls } = guardWith(true);

    await expect(
      guard.canActivate(httpContext(PROTECTED, signedIn({ 'x-step-up-token': TOKEN }))),
    ).resolves.toBe(true);
    expect(calls).toEqual([{ token: TOKEN, userId: USER_ID, purpose: 'settings.payment' }]);
  });

  it('answers FORBIDDEN without the header, before any verification', async () => {
    const { guard, calls } = guardWith(true);

    await expect(guard.canActivate(httpContext(PROTECTED, signedIn()))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(calls).toEqual([]);
  });

  it('answers FORBIDDEN to a token the service refuses', async () => {
    const { guard } = guardWith(false);

    await expect(
      guard.canActivate(httpContext(PROTECTED, signedIn({ 'x-step-up-token': TOKEN }))),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails closed with UNAUTHENTICATED without a request user', async () => {
    const { guard } = guardWith(true);

    await expect(
      guard.canActivate(
        httpContext(
          PROTECTED,
          requestOn('/api/v1/admin/things/payment', { headers: { 'x-step-up-token': TOKEN } }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('leaves a route without @RequiresStepUp untouched', async () => {
    const { guard, calls } = guardWith(false);

    await expect(guard.canActivate(httpContext(PLAIN, signedIn()))).resolves.toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('@RequiresStepUp', () => {
  it('refuses a purpose outside STEP_UP_PURPOSES', () => {
    expect(() => RequiresStepUp('settings.brand' as StepUpPurpose)).toThrow(/purpose/);
  });
});
