import { Injectable } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

/**
 * The current instant, and the injection token for it. Business logic asks the `Clock`, never
 * `new Date()`, so specs can fix time with `FixedClock` (`./testing.ts`).
 */
export abstract class Clock {
  abstract now(): Date;
}

/** The real clock: the only place in `apps/api` that reads the system time for business logic. */
@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Binds `Clock` to `SystemClock`; listed in the `providers` of a module that needs the time. */
export const clockProvider: Provider = { provide: Clock, useClass: SystemClock };
