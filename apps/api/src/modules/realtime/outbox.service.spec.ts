import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';

import { PersonalDataError } from '../../common/privacy/personal-data-guard.js';
import { OutboxEvent } from './entities/outbox-event.entity.js';
import { OUTBOX_RETENTION_DAYS } from './outbox.constants.js';
import { OutboxService } from './outbox.service.js';
import type { OutboxEventRecord } from './outbox.service.js';

const BRANCH = '0199a3c0-0000-7000-8000-0000000000b1';
const USER = '0199a3c0-0000-7000-8000-0000000000c1';
const ORDER = '0199a3c0-0000-7000-8000-000000000001';

const base = {
  type: 'order.status_changed',
  entityType: 'order',
  entityId: ORDER,
  version: 3,
  payload: { orderId: ORDER, status: 'ACCEPTED', rowVersion: 3 },
};

function fakeManager() {
  const insert = vi.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] });
  return { manager: { insert } as unknown as EntityManager, insert };
}

describe('OutboxService.add', () => {
  const service = new OutboxService();

  it('inserts one row through the caller manager, with nulls for the unused scope', async () => {
    const { manager, insert } = fakeManager();

    await service.add(manager, { ...base, audience: 'USER', audienceUserId: USER });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(OutboxEvent, {
      type: 'order.status_changed',
      entityType: 'order',
      entityId: ORDER,
      version: 3,
      audience: 'USER',
      branchId: null,
      audienceUserId: USER,
      payload: { orderId: ORDER, status: 'ACCEPTED', rowVersion: 3 },
    });
  });

  it('writes a branch event and a public event without a version', async () => {
    const { manager, insert } = fakeManager();

    await service.add(manager, { ...base, audience: 'BRANCH_STAFF', branchId: BRANCH });
    await service.add(manager, {
      type: 'config.changed',
      entityType: 'app_settings',
      entityId: 'maintenance',
      audience: 'PUBLIC',
      payload: { keys: ['maintenance'] },
    });

    expect(insert).toHaveBeenNthCalledWith(
      1,
      OutboxEvent,
      expect.objectContaining({ audience: 'BRANCH_STAFF', branchId: BRANCH, audienceUserId: null }),
    );
    expect(insert).toHaveBeenNthCalledWith(
      2,
      OutboxEvent,
      expect.objectContaining({
        audience: 'PUBLIC',
        entityId: 'maintenance',
        version: null,
        branchId: null,
        audienceUserId: null,
      }),
    );
  });

  // Each case breaks the static types on purpose: a caller without types (or with a cast) must
  // still be refused before anything is written.
  it.each([
    ['BRANCH_STAFF without its branch', { audience: 'BRANCH_STAFF' }],
    ['BRANCH_STAFF with an empty branch', { audience: 'BRANCH_STAFF', branchId: '' }],
    [
      'BRANCH_STAFF with a user too',
      { audience: 'BRANCH_STAFF', branchId: BRANCH, audienceUserId: USER },
    ],
    ['USER without its user', { audience: 'USER' }],
    ['USER with a branch too', { audience: 'USER', audienceUserId: USER, branchId: BRANCH }],
    ['PUBLIC with a branch', { audience: 'PUBLIC', branchId: BRANCH }],
    ['ADMIN with a user', { audience: 'ADMIN', audienceUserId: USER }],
  ])('refuses %s', async (_case, scope) => {
    const { manager, insert } = fakeManager();
    const event = { ...base, ...scope } as unknown as OutboxEventRecord;

    await expect(service.add(manager, event)).rejects.toThrow(/Outbox audience/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses a payload that is not an object', async () => {
    const { manager, insert } = fakeManager();
    const event = { ...base, audience: 'ADMIN', payload: ['x'] } as unknown as OutboxEventRecord;

    await expect(service.add(manager, event)).rejects.toThrow(/JSON object/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses personal data anywhere in the payload, before inserting', async () => {
    const { manager, insert } = fakeManager();

    await expect(
      service.add(manager, {
        ...base,
        audience: 'BRANCH_STAFF',
        branchId: BRANCH,
        payload: { orderId: ORDER, customer: { Phone: '+84901234567' } },
      }),
    ).rejects.toBeInstanceOf(PersonalDataError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('lets a failed insert reach the caller, so the business transaction rolls back', async () => {
    const insert = vi.fn().mockRejectedValue(new Error('insert failed'));
    const manager = { insert } as unknown as EntityManager;

    await expect(service.add(manager, { ...base, audience: 'ADMIN' })).rejects.toThrow(
      'insert failed',
    );
  });
});

describe('OUTBOX_RETENTION_DAYS', () => {
  it('is 7 days', () => {
    expect(OUTBOX_RETENTION_DAYS).toBe(7);
  });
});
