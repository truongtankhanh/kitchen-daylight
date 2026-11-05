import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';

import { AUDIT_ENTITY_LABEL_MAX_LENGTH, assertEntityLabel, AuditService } from './audit.service.js';
import type { AuditEntry } from './audit.service.js';
import { AuditLog } from './entities/audit-log.entity.js';

const ACTOR = '0199a3c0-0000-7000-8000-0000000000c1';
const BRANCH = '0199a3c0-0000-7000-8000-0000000000b1';
const ORDER = '0199a3c0-0000-7000-8000-000000000001';

const base: AuditEntry = {
  actorUserId: ACTOR,
  action: 'order.contact_reveal',
  entityType: 'ORDER',
  entityId: ORDER,
  entityLabel: 'BT-261105-007',
  branchId: BRANCH,
};

function fakeManager(insert = vi.fn().mockResolvedValue({})) {
  return { manager: { insert } as unknown as EntityManager, insert };
}

function thrownMessage(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
}

function serviceWithDefaultManager() {
  const fallback = fakeManager();
  const dataSource = { manager: fallback.manager } as unknown as DataSource;
  return { service: new AuditService(dataSource), fallbackInsert: fallback.insert };
}

describe('assertEntityLabel', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an order number', 'BT-261105-007'],
    ['an item name', 'Phở bò tái'],
    ['a display name', 'Nguyễn Văn An'],
    ['a name with a spaced at sign', 'Combo @ 99k'],
    ['the longest label', 'x'.repeat(AUDIT_ENTITY_LABEL_MAX_LENGTH)],
  ])('accepts %s', (_case, label) => {
    expect(() => {
      assertEntityLabel(label);
    }).not.toThrow();
  });

  it.each([
    ['an email', 'guest@example.com'],
    ['an email in upper case', 'GUEST@EXAMPLE.COM'],
    ['a name with an email', 'An (an.nguyen+kd@example.com)'],
    ['a tagged email', 'staff_01@kitchendaylight.example'],
  ])('refuses %s without repeating it', (_case, label) => {
    const message = thrownMessage(() => {
      assertEntityLabel(label);
    });

    expect(message).toMatch(/must not be an email/);
    expect(message).not.toContain(label);
  });

  it('refuses an empty or too long label', () => {
    expect(() => {
      assertEntityLabel('');
    }).toThrow(/non-empty/);
    expect(() => {
      assertEntityLabel('x'.repeat(AUDIT_ENTITY_LABEL_MAX_LENGTH + 1));
    }).toThrow(/at most/);
  });
});

describe('AuditService.write', () => {
  it('inserts one row through the caller manager, joining its transaction', async () => {
    const { service, fallbackInsert } = serviceWithDefaultManager();
    const { manager, insert } = fakeManager();

    await service.write(base, manager);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(AuditLog, {
      actorUserId: ACTOR,
      action: 'order.contact_reveal',
      entityType: 'ORDER',
      entityId: ORDER,
      entityLabel: 'BT-261105-007',
      branchId: BRANCH,
      diff: {},
    });
    expect(fallbackInsert).not.toHaveBeenCalled();
  });

  it('uses the DataSource manager when no manager is given', async () => {
    const { service, fallbackInsert } = serviceWithDefaultManager();

    await service.write({
      actorUserId: null,
      action: 'settings.change',
      entityType: 'APP_SETTINGS',
      entityId: 'maintenance',
      diff: { enabled: { from: false, to: true } },
    });

    expect(fallbackInsert).toHaveBeenCalledWith(AuditLog, {
      actorUserId: null,
      action: 'settings.change',
      entityType: 'APP_SETTINGS',
      entityId: 'maintenance',
      entityLabel: null,
      branchId: null,
      diff: { enabled: { from: false, to: true } },
    });
  });

  it('sanitizes the diff before inserting', async () => {
    const { service } = serviceWithDefaultManager();
    const { manager, insert } = fakeManager();

    await service.write(
      {
        actorUserId: ACTOR,
        action: 'settings.change',
        entityType: 'APP_SETTINGS',
        entityId: 'payment',
        diff: {
          accountNumber: { from: '0123456789', to: '9876543210' },
          stepUpToken: 'should-not-be-stored',
          bankName: { from: 'Example Bank', to: 'Example Bank' },
        },
      },
      manager,
    );

    expect(insert).toHaveBeenCalledWith(
      AuditLog,
      expect.objectContaining({
        diff: {
          accountNumberLast5: { from: '56789', to: '43210' },
          bankName: { from: 'Example Bank', to: 'Example Bank' },
        },
      }),
    );
  });

  // Each case breaks the static types on purpose: a caller without types (or with a cast) must
  // still be refused before anything is written.
  it.each([
    ['an unknown action', { action: 'order.explode' }, /AuditAction/],
    ['an action in the wrong case', { action: 'Order.contact_reveal' }, /AuditAction/],
    ['an unknown entity type', { entityType: 'order' }, /AuditEntityType/],
    ['an empty entity id', { entityId: '' }, /entityId/],
    ['a too long entity id', { entityId: 'x'.repeat(129) }, /entityId/],
    ['a missing actor', { actorUserId: undefined }, /actorUserId/],
    ['an empty actor', { actorUserId: '' }, /actorUserId/],
    ['an empty branch', { branchId: '' }, /branchId/],
    ['an array diff', { diff: ['x'] }, /JSON object/],
    ['an email label', { entityLabel: 'guest@example.com' }, /must not be an email/],
  ])('refuses %s', async (_case, change, message) => {
    const { service, fallbackInsert } = serviceWithDefaultManager();
    const { manager, insert } = fakeManager();
    const entry = { ...base, ...change } as unknown as AuditEntry;

    await expect(service.write(entry, manager)).rejects.toThrow(message);
    expect(insert).not.toHaveBeenCalled();
    expect(fallbackInsert).not.toHaveBeenCalled();
  });

  it('lets a failed insert reach the caller, so the business transaction rolls back', async () => {
    const { service } = serviceWithDefaultManager();
    const { manager } = fakeManager(vi.fn().mockRejectedValue(new Error('insert failed')));

    await expect(service.write(base, manager)).rejects.toThrow('insert failed');
  });
});
