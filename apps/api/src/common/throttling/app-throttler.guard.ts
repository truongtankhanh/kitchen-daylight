import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  DEFAULT_IPV6_SUBNET_PREFIX,
  getOptionsToken,
  getStorageToken,
  normalizeIp,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

import type { GuardedRequest } from '../auth/request-user.js';
import { throttleProfileOf } from './throttle-profiles.js';

/** Bucket of a request whose address Express could not read (a socket already closed). */
export const UNKNOWN_CLIENT = 'unknown';

/**
 * The client of a request (decision 0007 section 5): `req.ip`, which Express derives from the
 * socket, or from `X-Forwarded-For` only as far as `trust proxy` allows (`TRUST_PROXY_HOPS`, set in
 * `main.ts`). A header the client sends is never read here. IPv6 addresses are grouped by /64 and
 * IPv4-mapped addresses reduced to IPv4 by the library's `normalizeIp`.
 */
export function trackerOf(request: Pick<GuardedRequest, 'ip' | 'socket'>): string {
  const address = request.ip ?? request.socket?.remoteAddress;
  if (address === undefined || address === '') {
    return UNKNOWN_CLIENT;
  }
  return normalizeIp(address, DEFAULT_IPV6_SUBNET_PREFIX);
}

/** Storage key: throttler, profile (one counter per route group) and client. */
export function throttleKeyOf(throttlerName: string, profileName: string, tracker: string): string {
  return `${throttlerName}:${profileName}:${tracker}`;
}

/**
 * The global throttler guard (`APP_GUARD`, first of the three; `AppModule`). The library's own
 * guard with the tracker above and a key per route group instead of per handler, so the routes of
 * one 0008 group (for example customer login and social sign-in) share their per-IP figure.
 * A refusal is the library's `ThrottlerException`, which the problem+json filter answers as
 * `429 RATE_LIMITED` with a plain `Retry-After` (A0-T3).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super(options, storage, reflector);
  }

  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    return Promise.resolve(trackerOf(request as Pick<GuardedRequest, 'ip' | 'socket'>));
  }

  protected override generateKey(
    context: ExecutionContext,
    tracker: string,
    throttlerName: string,
  ): string {
    return throttleKeyOf(throttlerName, throttleProfileOf(context).name, tracker);
  }
}
