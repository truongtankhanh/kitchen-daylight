import type { IncomingHttpHeaders } from 'node:http';

import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { APP_CONFIG } from '../../config/config.module.js';
import type { AppStoreUrls, ServerConfig } from '../../config/load-config.js';
import { isUnderPrefix, routePathOf } from '../auth/request-user.js';
import type { GuardedRequest } from '../auth/request-user.js';
import { ApiError } from '../errors/api-error.js';
import { Clock } from '../time/clock.js';
import { GateSnapshot } from './gate-snapshot.js';
import type { GateState } from './gate-snapshot.js';
import { isBelowMinimum } from './semver.js';

/** The versioned API: the only surface the gates apply to (decision 0005 section 1). */
const VERSIONED_PREFIX = '/api/v1/';

/**
 * Paths under `/api/v1` that both gates let through (api-outline Conventions "Maintenance"; brief
 * L13, E18; api-divergences D-115):
 *
 * - `/admin/**`, `/admin/auth/*` included, so an admin can sign in and switch maintenance off;
 * - `/me/mfa/**`, `MANAGER` and `ADMIN` only: the TOTP enrolment of a staff sign-in;
 * - `/meta/config`, which the maintenance and forced-update screens read;
 * - `/internal/**`, for operations.
 *
 * Paths outside `/api/v1` (`/api/health`, `/api/docs`) are never gated. Nothing customer-facing is
 * listed here.
 */
export const GATE_EXEMPT_PREFIXES: readonly string[] = Object.freeze([
  '/api/v1/admin/',
  '/api/v1/me/mfa/',
  '/api/v1/meta/config/',
  '/api/v1/internal/',
]);

/** The mobile clients the version gate reads (api-outline Conventions "Client headers"). */
export const GATED_CLIENTS = { 'mobile-ios': 'ios', 'mobile-android': 'android' } as const;
type GatedClient = keyof typeof GATED_CLIENTS;
export type AppPlatform = (typeof GATED_CLIENTS)[GatedClient];

export type GateDecision =
  | { readonly kind: 'PASS' }
  | {
      readonly kind: 'MAINTENANCE';
      readonly message: string | null;
      readonly expectedBackAt: string | null;
    }
  | { readonly kind: 'UPGRADE_REQUIRED'; readonly storeUrl: string | null };

const PASS: GateDecision = Object.freeze({ kind: 'PASS' });

/** True for a registered route path (lower case) that neither gate applies to. */
export function isGateExempt(routePath: string): boolean {
  const path = routePath.toLowerCase();
  return (
    !isUnderPrefix(path, VERSIONED_PREFIX) ||
    GATE_EXEMPT_PREFIXES.some((prefix) => isUnderPrefix(path, prefix))
  );
}

/** One header value, or `undefined` when it is missing or repeated. */
function headerOf(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function platformOf(client: string | undefined): AppPlatform | undefined {
  return client !== undefined && Object.hasOwn(GATED_CLIENTS, client)
    ? GATED_CLIENTS[client as GatedClient]
    : undefined;
}

export interface GateRequest {
  /** Registered route path, lower case (`routePathOf`). */
  readonly routePath: string;
  readonly client: string | undefined;
  readonly appVersion: string | undefined;
}

/**
 * The decision for one request, before authentication, so a blocked path answers the same with or
 * without a token. Maintenance first: while the service is down, an update does not help.
 *
 * The version gate is a user-experience gate, not a security control: `X-Client` and
 * `X-App-Version` are client claims, and a missing or malformed version, `admin-web` and unknown
 * clients pass. Authorization never depends on it.
 */
export function decideGate(
  request: GateRequest,
  state: GateState,
  storeUrls: AppStoreUrls,
): GateDecision {
  if (isGateExempt(request.routePath)) {
    return PASS;
  }
  if (state.maintenance.enabled) {
    return {
      kind: 'MAINTENANCE',
      message: state.maintenance.message,
      expectedBackAt: state.maintenance.expectedBackAt,
    };
  }
  const platform = platformOf(request.client);
  if (platform !== undefined && isBelowMinimum(request.appVersion, state.minAppVersion[platform])) {
    return { kind: 'UPGRADE_REQUIRED', storeUrl: storeUrls[platform] };
  }
  return PASS;
}

/** Whole seconds until `expectedBackAt`, or `undefined` when it is unset, invalid or past. */
export function retryAfterSeconds(expectedBackAt: string | null, now: Date): number | undefined {
  if (expectedBackAt === null) {
    return undefined;
  }
  const seconds = Math.ceil((Date.parse(expectedBackAt) - now.getTime()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** The part of the HTTP response the guard writes: `Retry-After`. */
interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

/**
 * The maintenance and minimum-version gates (A4-T3), a global guard registered after the
 * throttler and before the deny-by-default `AuthGuard` (`AppModule`). An exempt path is decided
 * without reading the settings; any other reads the in-memory `GateSnapshot`.
 *
 * - `maintenance.enabled`: `503 MAINTENANCE` with `message` and `expectedBackAt`, and
 *   `Retry-After` while `expectedBackAt` is in the future (decision 0007 section 9).
 * - A mobile client below `minAppVersion` of its platform: `400 UPGRADE_REQUIRED` with the
 *   `storeUrl` of the platform (`null` when unset); decision 0007 section 9 gives 400, not 426.
 *
 * A non-HTTP context (the realtime gateway, A10) is not gated here.
 */
@Injectable()
export class AppGatesGuard implements CanActivate {
  constructor(
    @Inject(GateSnapshot) private readonly snapshot: GateSnapshot,
    @Inject(APP_CONFIG) private readonly config: ServerConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<GuardedRequest>();
    const routePath = routePathOf(request);
    if (isGateExempt(routePath)) {
      return true;
    }
    const decision = decideGate(
      {
        routePath,
        client: headerOf(request.headers, 'x-client'),
        appVersion: headerOf(request.headers, 'x-app-version'),
      },
      await this.snapshot.current(),
      this.config.appStoreUrls,
    );
    switch (decision.kind) {
      case 'PASS':
        return true;
      case 'MAINTENANCE': {
        const retryAfter = retryAfterSeconds(decision.expectedBackAt, this.clock.now());
        if (retryAfter !== undefined) {
          http.getResponse<HeaderResponse>().setHeader('Retry-After', String(retryAfter));
        }
        throw new ApiError('MAINTENANCE', {
          detail: 'The service is under maintenance.',
          extras: { message: decision.message, expectedBackAt: decision.expectedBackAt },
        });
      }
      case 'UPGRADE_REQUIRED':
        throw new ApiError('UPGRADE_REQUIRED', {
          detail: 'This version of the app is no longer supported; update it.',
          extras: { storeUrl: decision.storeUrl },
        });
    }
  }
}
