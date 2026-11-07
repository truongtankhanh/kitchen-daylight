import { Inject, Injectable, Logger } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';

import type { RequestUser } from '../../../common/auth/request-user.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { Clock } from '../../../common/time/clock.js';
import type { AuditAction } from '../../audit/audit-actions.js';
import { AuditService } from '../../audit/audit.service.js';
import { UsersService } from '../../users/users.service.js';
import {
  ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
  ACCESS_TOKEN_ISSUER,
} from '../access-token.service.js';
import { ACCESS_TOKEN_ALGORITHM, KeySet } from '../key-set.js';
import { MfaService } from '../mfa/mfa.service.js';

/**
 * `typ` header of a step-up token. The access-token verifier accepts only `at+jwt` and the MFA
 * verifiers only their own types, so a step-up token never passes as either; the step-up verifier
 * accepts only this type, so an access token never passes as a step-up token.
 */
export const STEP_UP_TOKEN_TYPE = 'step-up+jwt';

/** `aud` of a step-up token, distinct from the access token's `kd-api` (decision 0008 section 9). */
export const STEP_UP_AUDIENCE = 'kd-api:step-up';

/**
 * Lifetime of a step-up token: 5 minutes, one confirm dialog (api-outline says "short-lived",
 * brief L14; accepted by the owner 2026-11-07, api-divergences D-099). The token is reusable until
 * it expires: consuming it on first use would make a failed save (`400`, `409 STALE_VERSION`)
 * cost a new TOTP step.
 */
export const STEP_UP_TTL_SECONDS = 5 * 60;

/**
 * What a step-up token may authorise, one value per protected action. `settings.payment`: the
 * `PUT /admin/app-settings` of the `payment` key (A4-T2; api-outline, brief L14).
 */
export const STEP_UP_PURPOSES = ['settings.payment'] as const;
export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

/** Audit codes of the step-up (catalogue in `@kd/contracts`; brief E17, L14). */
export const STEP_UP_AUDIT = {
  succeeded: 'auth.step_up_succeeded',
  failed: 'auth.step_up_failed',
} as const satisfies Readonly<Record<string, AuditAction>>;

const PURPOSES: ReadonlySet<string> = new Set(STEP_UP_PURPOSES);

export function isStepUpPurpose(value: unknown): value is StepUpPurpose {
  return typeof value === 'string' && PURPOSES.has(value);
}

export interface StepUpGrant {
  /** Never logged, audited or put in an error. */
  readonly stepUpToken: string;
  readonly expiresAt: Date;
}

export interface StepUpClaims {
  readonly userId: string;
  readonly purpose: StepUpPurpose;
}

/**
 * Signs a step-up token for `userId` and `purpose`, valid from `now` for `STEP_UP_TTL_SECONDS`:
 * ES256 with the access-token key and `kid` (A1-T6), `typ: step-up+jwt`, claims `iss`, `aud`
 * (`STEP_UP_AUDIENCE`), `sub`, `purpose`, `iat`, `exp`; no `role`, no `sid`.
 */
export async function signStepUpToken(
  keys: KeySet,
  now: Date,
  userId: string,
  purpose: StepUpPurpose,
): Promise<StepUpGrant> {
  const { keyId, key } = keys.signingKey();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAt + STEP_UP_TTL_SECONDS;
  const stepUpToken = await new SignJWT({ purpose })
    .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, kid: keyId, typ: STEP_UP_TOKEN_TYPE })
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(STEP_UP_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(key);
  return { stepUpToken, expiresAt: new Date(expiresAtSeconds * 1000) };
}

/**
 * The claims of an authentic, unexpired step-up token, else `null` (malformed, unknown `kid`, bad
 * signature, another `typ` or `aud` such as an access token, expired, unknown purpose). The caller
 * answers without saying which check failed.
 */
export async function verifyStepUpToken(
  keys: KeySet,
  now: Date,
  token: string,
): Promise<StepUpClaims | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      (header) => {
        const key = header.kid === undefined ? undefined : keys.verificationKey(header.kid);
        if (key === undefined) {
          throw new Error('Unknown key id.');
        }
        return key;
      },
      {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: STEP_UP_AUDIENCE,
        typ: STEP_UP_TOKEN_TYPE,
        requiredClaims: ['sub', 'purpose', 'iat', 'exp'],
        clockTolerance: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
      },
    );
    const { sub, purpose } = payload;
    if (typeof sub !== 'string' || sub === '' || !isStepUpPurpose(purpose)) {
      return null;
    }
    return { userId: sub, purpose };
  } catch {
    return null;
  }
}

/**
 * The admin step-up (api-outline staff transport, brief L14, proposal; A3-T6): a current TOTP code
 * buys a short-lived token for one purpose, which `@RequiresStepUp(purpose)` routes demand in the
 * `X-Step-Up-Token` header. The code goes through `MfaService.verifyCurrentCode` (replay rule and
 * staff lockout of A3-T2). The code and the token are never logged, audited or put in an error.
 */
@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(KeySet) private readonly keys: KeySet,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * `POST /admin/auth/step-up`. The account is read again (the route is `@Sensitive()` too): an
   * `ACTIVE` `ADMIN`, else `UNAUTHENTICATED` or `FORBIDDEN`. A wrong, replayed or locked-out code is
   * `CODE_INVALID` and `auth.step_up_failed`; success writes `auth.step_up_succeeded` in the
   * transaction that claims the TOTP step, then signs the token.
   */
  async grant(actor: RequestUser, typedCode: string, purpose: StepUpPurpose): Promise<StepUpGrant> {
    const user = await this.users.findById(actor.id);
    if (user === null || user.status !== 'ACTIVE') {
      throw new ApiError('UNAUTHENTICATED');
    }
    if (user.role !== 'ADMIN') {
      throw new ApiError('FORBIDDEN');
    }
    await this.mfa.verifyCurrentCode(
      user,
      typedCode,
      { action: STEP_UP_AUDIT.failed, actorUserId: user.id, diff: { purpose } },
      async (em) => {
        await this.audit.write(
          {
            actorUserId: user.id,
            action: STEP_UP_AUDIT.succeeded,
            entityType: 'USER',
            entityId: user.id,
            diff: { purpose },
          },
          em,
        );
      },
    );
    const grant = await signStepUpToken(this.keys, this.clock.now(), user.id, purpose);
    this.logger.log(
      { event: STEP_UP_AUDIT.succeeded, userId: user.id, purpose },
      'step-up granted',
    );
    return grant;
  }

  /** True when `token` is a valid step-up token of `userId` for `purpose`, now. */
  async verify(token: string, userId: string, purpose: StepUpPurpose): Promise<boolean> {
    const claims = await verifyStepUpToken(this.keys, this.clock.now(), token);
    return claims !== null && claims.userId === userId && claims.purpose === purpose;
  }
}
