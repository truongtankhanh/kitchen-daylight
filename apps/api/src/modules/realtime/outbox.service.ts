import { Injectable } from '@nestjs/common';
import type { OutboxEventOf } from '@kd/contracts';
import type { EntityManager } from 'typeorm';

import { assertNoPersonalData } from '../../common/privacy/personal-data-guard.js';
import { OutboxEvent } from './entities/outbox-event.entity.js';

/**
 * What a service hands to `add`. Broad on purpose (`type: string`) while `RealtimeEventMap` is
 * empty; an emitting service builds it with `outboxEvent()` from `@kd/contracts`.
 */
export type OutboxEventRecord = OutboxEventOf<string, object>;

function assertAudienceScope(event: OutboxEventRecord): void {
  const branchId = event.branchId ?? null;
  const audienceUserId = event.audienceUserId ?? null;
  const consistent =
    event.audience === 'BRANCH_STAFF'
      ? branchId !== null && branchId !== '' && audienceUserId === null
      : event.audience === 'USER'
        ? audienceUserId !== null && audienceUserId !== '' && branchId === null
        : branchId === null && audienceUserId === null;
  if (!consistent) {
    throw new Error(
      `Outbox audience ${event.audience} needs branchId only for BRANCH_STAFF and audienceUserId only for USER.`,
    );
  }
}

function assertPayloadObject(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('An outbox payload is a JSON object.');
  }
}

/**
 * Writes realtime events into `outbox_events` (transactional outbox, ADR-0007). The relay that
 * publishes them is A10.
 */
@Injectable()
export class OutboxService {
  /**
   * Inserts one event through the caller's `EntityManager`, so the row commits or rolls back with
   * the business change. Refuses (programmer error) an audience that disagrees with `branchId` or
   * `audienceUserId`, a payload that is not an object, and any personal-data key in the payload.
   */
  async add(manager: EntityManager, event: OutboxEventRecord): Promise<void> {
    assertAudienceScope(event);
    assertPayloadObject(event.payload);
    assertNoPersonalData(event.payload);
    await manager.insert(OutboxEvent, {
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      version: event.version ?? null,
      audience: event.audience,
      branchId: event.branchId ?? null,
      audienceUserId: event.audienceUserId ?? null,
      payload: event.payload,
    });
  }
}
