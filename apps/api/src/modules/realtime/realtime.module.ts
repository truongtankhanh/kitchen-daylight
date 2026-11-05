import { Module } from '@nestjs/common';

import { OutboxService } from './outbox.service.js';

/**
 * Realtime slice (decision 0007 section 3). For now the outbox writer only; the relay and the
 * Socket.IO gateway arrive with A10. A module that emits events imports this one.
 */
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class RealtimeModule {}
