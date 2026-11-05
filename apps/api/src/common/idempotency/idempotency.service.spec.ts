import { FindOperator } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../errors/api-error.js';
import { PersonalDataError } from '../privacy/personal-data-guard.js';
import { FixedClock } from '../time/testing.js';
import { IdempotencyKeyRecord } from './entities/idempotency-key.entity.js';
import {
  IDEMPOTENCY_RETENTION_HOURS,
  IdempotencyService,
  INSERT_KEY_SQL,
} from './idempotency.service.js';
import type { IdempotencyBeginInput } from './idempotency.service.js';
import { hashRequest } from './request-hash.js';

const CUSTOMER = '0199a3c0-0000-7000-8000-0000000000c1';
const OTHER_CUSTOMER = '0199a3c0-0000-7000-8000-0000000000c2';
const ORDER = '0199a3c0-0000-7000-8000-000000000001';
const KEY = '0199a3c0-0000-7000-8000-00000000abcd';
const HOUR = 3_600_000;

type Row = Pick<
  IdempotencyKeyRecord,
  | 'id'
  | 'scope'
  | 'actorId'
  | 'key'
  | 'requestHash'
  | 'responseStatus'
  | 'responseRef'
  | 'createdAt'
  | 'completedAt'
  | 'expiresAt'
>;

/**
 * An in-memory `EntityManager` that implements only what `IdempotencyService` calls. `hideNextRead`
 * makes the next `findOneBy` miss, as when a concurrent transaction commits the same key between
 * the first read and the insert.
 */
function fakeManager() {
  const rows: Row[] = [];
  let ids = 0;
  let hideNextRead = false;

  const matches = (row: Row, where: Partial<Row>): boolean =>
    Object.entries(where).every(([field, value]) => row[field as keyof Row] === value);

  const findOneBy = vi.fn((entity: unknown, where: Partial<Row>) => {
    expect(entity).toBe(IdempotencyKeyRecord);
    if (hideNextRead) {
      hideNextRead = false;
      return Promise.resolve(null);
    }
    return Promise.resolve(rows.find((row) => matches(row, where)) ?? null);
  });

  const query = vi.fn((sql: string, params: unknown[]) => {
    expect(sql).toBe(INSERT_KEY_SQL);
    const [scope, actorId, key, requestHash, createdAt, expiresAt] = params as [
      string,
      string,
      string,
      string,
      Date,
      Date,
    ];
    if (rows.some((row) => matches(row, { scope, actorId, key }))) {
      return Promise.resolve([]);
    }
    ids += 1;
    const id = `row-${String(ids)}`;
    rows.push({
      id,
      scope,
      actorId,
      key,
      requestHash,
      responseStatus: null,
      responseRef: null,
      createdAt,
      completedAt: null,
      expiresAt,
    });
    return Promise.resolve([{ id }]);
  });

  const update = vi.fn((_entity: unknown, where: { id: string }, values: Partial<Row>) => {
    const row = rows.find((candidate) => candidate.id === where.id);
    if (row !== undefined) {
      Object.assign(row, values);
    }
    return Promise.resolve({ affected: row === undefined ? 0 : 1, raw: [], generatedMaps: [] });
  });

  const remove = vi.fn((_entity: unknown, where: Record<string, unknown>) => {
    const before = rows.length;
    const expiresAt = where['expiresAt'];
    const keep = rows.filter((row) => {
      if (typeof where['id'] === 'string') {
        return row.id !== where['id'];
      }
      if (expiresAt instanceof FindOperator && expiresAt.type === 'lessThanOrEqual') {
        return row.expiresAt.getTime() > (expiresAt.value as Date).getTime();
      }
      throw new Error('Unexpected delete criteria.');
    });
    rows.splice(0, rows.length, ...keep);
    return Promise.resolve({ affected: before - rows.length, raw: [] });
  });

  const manager = { findOneBy, query, update, delete: remove } as unknown as EntityManager;
  return {
    manager,
    rows,
    query,
    calls: () => findOneBy.mock.calls.length + query.mock.calls.length + update.mock.calls.length,
    hideNextRead: () => {
      hideNextRead = true;
    },
  };
}

function setup() {
  const clock = new FixedClock('2026-11-05T03:00:00Z');
  return { clock, service: new IdempotencyService(clock), ...fakeManager() };
}

const body = { branchId: 'b1', items: [{ menuItemId: 'm1', quantity: 2 }], expectedTotal: 90000 };

const begin = (overrides: Partial<IdempotencyBeginInput> = {}): IdempotencyBeginInput => ({
  scope: 'orders.create',
  actorId: CUSTOMER,
  key: KEY,
  method: 'POST',
  routeTemplate: '/orders',
  pathParams: {},
  requestBody: body,
  ...overrides,
});

const ref = { scope: 'orders.create', actorId: CUSTOMER, key: KEY };

describe('IdempotencyService.begin', () => {
  it('proceeds with a new key and stores its hash and 24-hour expiry, not completed', async () => {
    const { service, manager, rows, query } = setup();

    await expect(service.begin(manager, begin())).resolves.toEqual({ kind: 'proceed' });

    expect(query).toHaveBeenCalledWith(INSERT_KEY_SQL, [
      'orders.create',
      CUSTOMER,
      KEY,
      hashRequest('POST', '/orders', body),
      new Date('2026-11-05T03:00:00Z'),
      new Date('2026-11-06T03:00:00Z'),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ completedAt: null, responseStatus: null, responseRef: null });
    expect(IDEMPOTENCY_RETENTION_HOURS).toBe(24);
  });

  it('replays the stored result for the same request, whatever its key order', async () => {
    const { service, manager, rows } = setup();
    await service.begin(manager, begin());
    await service.complete(manager, ref, { status: 201, ref: { orderId: ORDER } });

    const reordered = {
      expectedTotal: 90000,
      items: [{ quantity: 2, menuItemId: 'm1' }],
      branchId: 'b1',
    };
    await expect(service.begin(manager, begin({ requestBody: reordered }))).resolves.toEqual({
      kind: 'replay',
      status: 201,
      ref: { orderId: ORDER },
    });
    expect(rows).toHaveLength(1);
  });

  it('refuses the same key with a different body with IDEMPOTENCY_CONFLICT (409)', async () => {
    const { service, manager } = setup();
    await service.begin(manager, begin());
    await service.complete(manager, ref, { status: 201, ref: { orderId: ORDER } });

    const changed = begin({ requestBody: { ...body, expectedTotal: 95000 } });
    const error = await service.begin(manager, changed).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
  });

  it('replaces an expired key instead of replaying it, even with another body', async () => {
    const { clock, service, manager, rows } = setup();
    await service.begin(manager, begin());
    await service.complete(manager, ref, { status: 201, ref: { orderId: ORDER } });
    const firstId = rows[0]?.id;

    clock.advance(24 * HOUR);
    const changed = begin({ requestBody: { ...body, expectedTotal: 95000 } });

    await expect(service.begin(manager, changed)).resolves.toEqual({ kind: 'proceed' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(firstId);
    expect(rows[0]).toMatchObject({
      completedAt: null,
      requestHash: hashRequest('POST', '/orders', changed.requestBody),
      expiresAt: new Date('2026-11-07T03:00:00Z'),
    });
  });

  it('still replays one millisecond before the expiry', async () => {
    const { clock, service, manager } = setup();
    await service.begin(manager, begin());
    await service.complete(manager, ref, { status: 201, ref: { orderId: ORDER } });

    clock.advance(24 * HOUR - 1);

    await expect(service.begin(manager, begin())).resolves.toMatchObject({ kind: 'replay' });
  });

  it('keeps two actors and two scopes with the same key independent', async () => {
    const { service, manager, rows } = setup();

    await expect(service.begin(manager, begin())).resolves.toEqual({ kind: 'proceed' });
    await expect(service.begin(manager, begin({ actorId: OTHER_CUSTOMER }))).resolves.toEqual({
      kind: 'proceed',
    });
    await expect(
      service.begin(
        manager,
        begin({ scope: 'reservations.create', routeTemplate: '/reservations' }),
      ),
    ).resolves.toEqual({ kind: 'proceed' });
    expect(rows).toHaveLength(3);
  });

  it('refuses the same key sent to another target of the same route, instead of replaying', async () => {
    const { service, manager } = setup();
    const points = (userId: string) =>
      begin({
        scope: 'admin.points.adjust',
        routeTemplate: '/admin/users/{id}/points',
        pathParams: { id: userId },
        requestBody: { delta: 100, note: 'Goodwill gesture' },
      });
    await service.begin(manager, points(CUSTOMER));
    await service.complete(
      manager,
      { scope: 'admin.points.adjust', actorId: CUSTOMER, key: KEY },
      { status: 201, ref: { ledgerEntryId: 'l1' } },
    );

    await expect(service.begin(manager, points(OTHER_CUSTOMER))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('replays a duplicate whose first request committed while the insert waited', async () => {
    const { service, manager, hideNextRead } = setup();
    await service.begin(manager, begin());
    await service.complete(manager, ref, { status: 201, ref: { orderId: ORDER } });

    hideNextRead();

    await expect(service.begin(manager, begin())).resolves.toEqual({
      kind: 'replay',
      status: 201,
      ref: { orderId: ORDER },
    });
  });

  it('refuses a concurrent duplicate with another body after the first committed', async () => {
    const { service, manager, hideNextRead } = setup();
    await service.begin(manager, begin());
    await service.complete(manager, ref, { status: 201, ref: { orderId: ORDER } });

    hideNextRead();

    await expect(
      service.begin(manager, begin({ requestBody: { ...body, expectedTotal: 1 } })),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('throws a programmer error for a key that was begun but never completed', async () => {
    const { service, manager } = setup();
    await service.begin(manager, begin());

    await expect(service.begin(manager, begin())).rejects.toThrow(/has no result/);
  });

  it.each([
    ['an empty scope', { scope: '' }],
    ['a scope without a dot', { scope: 'orders' }],
    ['an upper-case scope', { scope: 'Orders.create' }],
    ['an empty actor', { actorId: '' }],
    ['a malformed key', { key: 'short' }],
  ])('refuses %s before touching the database', async (_case, change) => {
    const { service, manager, calls } = setup();

    await expect(service.begin(manager, begin(change))).rejects.toThrow();
    expect(calls()).toBe(0);
  });

  it('lets a failed insert reach the caller', async () => {
    const { service, manager, query } = setup();
    query.mockRejectedValueOnce(new Error('insert failed'));

    await expect(service.begin(manager, begin())).rejects.toThrow('insert failed');
  });
});

describe('IdempotencyService.complete', () => {
  it('stores the status, a copy of the ref and the completion time', async () => {
    const { clock, service, manager, rows } = setup();
    await service.begin(manager, begin());
    clock.advance(1500);
    const result = { orderId: ORDER };

    await service.complete(manager, ref, { status: 201, ref: result });

    expect(rows[0]).toMatchObject({
      responseStatus: 201,
      responseRef: { orderId: ORDER },
      completedAt: new Date('2026-11-05T03:00:01.500Z'),
    });
    expect(rows[0]?.responseRef).not.toBe(result);
  });

  it('refuses a ref with personal data, before writing', async () => {
    const { service, manager, rows } = setup();
    await service.begin(manager, begin());

    await expect(
      service.complete(manager, ref, {
        status: 201,
        ref: { orderId: ORDER, customer: { phone: '+84901234567' } },
      }),
    ).rejects.toBeInstanceOf(PersonalDataError);
    expect(rows[0]?.completedAt).toBeNull();
  });

  it.each([
    ['a failure status', { status: 409, ref: { orderId: ORDER } }],
    ['a non-integer status', { status: 201.5, ref: { orderId: ORDER } }],
    ['an array ref', { status: 201, ref: [ORDER] }],
    ['a null ref', { status: 201, ref: null }],
  ])('refuses %s', async (_case, result) => {
    const { service, manager, rows } = setup();
    await service.begin(manager, begin());

    // Breaks the static types on purpose: an untyped caller must still be refused.
    await expect(service.complete(manager, ref, result as never)).rejects.toThrow();
    expect(rows[0]?.completedAt).toBeNull();
  });

  it('refuses a key that was not begun, or completes twice', async () => {
    const { service, manager } = setup();
    const result = { status: 201, ref: { orderId: ORDER } };

    await expect(service.complete(manager, ref, result)).rejects.toThrow(/begin/);

    await service.begin(manager, begin());
    await service.complete(manager, ref, result);
    await expect(service.complete(manager, ref, result)).rejects.toThrow(/begin/);
  });
});

describe('IdempotencyService.deleteExpired', () => {
  it('deletes the expired keys only and returns how many', async () => {
    const { clock, service, manager, rows } = setup();
    await service.begin(manager, begin());
    clock.advance(2 * HOUR);
    await service.begin(manager, begin({ actorId: OTHER_CUSTOMER }));

    clock.advance(23 * HOUR);

    await expect(service.deleteExpired(manager)).resolves.toBe(1);
    expect(rows.map((row) => row.actorId)).toEqual([OTHER_CUSTOMER]);
    await expect(service.deleteExpired(manager)).resolves.toBe(0);
  });
});
