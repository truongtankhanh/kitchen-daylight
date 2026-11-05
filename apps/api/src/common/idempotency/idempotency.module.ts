import { Module } from '@nestjs/common';

import { clockProvider } from '../time/clock.js';
import { IdempotencyService } from './idempotency.service.js';

/**
 * The `Idempotency-Key` store (decision 0007 sections 3 and 10). Imported by the modules whose
 * endpoints take the header: orders (A8-T4), reservations (A14-T2), manual points (A15-T4). The
 * expiry purge schedule is A12-T2. The `@IdempotencyKey()` decorator needs no provider.
 */
@Module({
  providers: [IdempotencyService, clockProvider],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
