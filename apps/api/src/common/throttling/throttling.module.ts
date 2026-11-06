import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { ThrottlerModuleOptions, ThrottlerOptions } from '@nestjs/throttler';

import { clockProvider } from '../time/clock.js';
import { AccountThrottleService } from './account-throttle.service.js';
import { THROTTLER_NAMES, throttleProfileOf } from './throttle-profiles.js';
import type { ThrottlerName } from './throttle-profiles.js';

/** One named throttler whose figures come from the route's profile; skipped for other profiles. */
function namedThrottler(name: ThrottlerName): ThrottlerOptions {
  return {
    name,
    limit: (context) => throttleProfileOf(context).limit,
    ttl: (context) => throttleProfileOf(context).ttl,
    skipIf: (context) => throttleProfileOf(context).throttler !== name,
  };
}

/** `default` (lenient, every other route) and `auth` (strict prefixes), decision 0007 section 5. */
export const THROTTLER_MODULE_OPTIONS: ThrottlerModuleOptions = {
  throttlers: THROTTLER_NAMES.map(namedThrottler),
};

/**
 * Throttling (decision 0007 section 5; figures in decision 0008 section 7).
 *
 * - **Per client (IP):** `@nestjs/throttler` with its built-in **in-process memory store**, through
 *   the global `AppThrottlerGuard` that `AppModule` registers first. The strict `auth` throttler is
 *   chosen by URL prefix (`throttle-profiles.ts`); `@SkipThrottle({ default: true, auth: true })`
 *   exempts a route (the health check). A restart empties these counters (accepted, 0007).
 * - **Per account:** `AccountThrottleService`, in PostgreSQL.
 *
 * **Blocking condition for scaling out (ADR-0003 "Abuse protection", ADR-0004, 0007 section 5):**
 * the memory counters are per process. Before the API runs a second instance in any tier, rate
 * limiting must move to a shared layer, AWS WAF rate-based rules or a Redis-backed
 * `ThrottlerStorage`; the memory store is never used with two instances. The client address is
 * right only with `TRUST_PROXY_HOPS` equal to the real proxy count (0 or 1, `main.ts`).
 */
@Module({
  imports: [ThrottlerModule.forRoot(THROTTLER_MODULE_OPTIONS)],
  providers: [AccountThrottleService, clockProvider],
  exports: [ThrottlerModule, AccountThrottleService],
})
export class ThrottlingModule {}
