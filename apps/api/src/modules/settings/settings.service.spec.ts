import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { User } from '../users/entities/user.entity.js';
import { AppSetting } from './entities/app-setting.entity.js';
import { toOrderingStored } from './schema/ordering.schema.js';
import { SETTING_DEFAULTS } from './settings-defaults.js';
import { SettingsService } from './settings.service.js';

const ADMIN_ID = '01930000-0000-7000-8000-0000000000d1';
const OTHER_ADMIN_ID = '01930000-0000-7000-8000-0000000000d2';
const UPDATED_AT = new Date('2026-11-08T03:00:00.000Z');
const WRITTEN_AT = new Date('2026-11-08T03:05:00.000Z');

const ADMINS: Readonly<Record<string, string>> = {
  [ADMIN_ID]: 'Quản trị Mẫu',
  [OTHER_ADMIN_ID]: 'Quản trị Khác',
};

/**
 * A stand-in `EntityManager`: `findOne(AppSetting)` answers the next of `rows` (the last one
 * repeats), `findOne(User)` the fictional admins, and every query builder call chains to an
 * `execute` that answers `written`. The SQL itself is covered by
 * test/integration/settings.int-spec.ts.
 */
function fakeManager(rows: (Partial<AppSetting> | null)[], written: unknown[] = []) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'insert',
    'into',
    'values',
    'orIgnore',
    'update',
    'set',
    'where',
    'returning',
    'updateEntity',
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder['execute'] = vi.fn(() => Promise.resolve({ raw: written }));
  let read = 0;
  const findOne = vi.fn((entity: unknown, options: { where: { id?: string } }) => {
    if (entity === AppSetting) {
      const row = rows[Math.min(read, rows.length - 1)] ?? null;
      read += 1;
      return Promise.resolve(row);
    }
    if (entity === User) {
      const id = options.where.id ?? '';
      const name = ADMINS[id];
      return Promise.resolve(name === undefined ? null : { id, displayName: name });
    }
    return Promise.resolve(null);
  });
  const manager = { findOne, createQueryBuilder: vi.fn(() => builder) };
  return { builder, findOne, em: manager as unknown as EntityManager };
}

function serviceWith(em: EntityManager): SettingsService {
  return new SettingsService({ manager: em } as unknown as DataSource);
}

function orderingRow(rowVersion: number, updatedBy: string | null): Partial<AppSetting> {
  return {
    key: 'ordering',
    value: toOrderingStored({ ...SETTING_DEFAULTS.ordering, maxItemQuantity: 50 }),
    rowVersion,
    updatedBy,
    updatedAt: UPDATED_AT,
  };
}

async function apiErrorOf(work: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('SettingsService', () => {
  describe('get', () => {
    it('reads a missing row as the code default with rowVersion 0', async () => {
      const { em, findOne } = fakeManager([null]);

      const record = await serviceWith(em).get('ordering');

      expect(record).toEqual({
        value: SETTING_DEFAULTS.ordering,
        rowVersion: 0,
        updatedBy: null,
        updatedAt: null,
      });
      expect(record.value).not.toBe(SETTING_DEFAULTS.ordering);
      expect(findOne).toHaveBeenCalledWith(AppSetting, { where: { key: 'ordering' } });
    });

    it('looks a key up by its snake_case storage key', async () => {
      const { em, findOne } = fakeManager([null]);

      await serviceWith(em).get('minAppVersion');

      expect(findOne).toHaveBeenCalledWith(AppSetting, { where: { key: 'min_app_version' } });
    });

    it('maps a stored row to camelCase with its version, editor name and time', async () => {
      const { em } = fakeManager([orderingRow(3, ADMIN_ID)]);

      const record = await serviceWith(em).get('ordering');

      expect(record).toEqual({
        value: { ...SETTING_DEFAULTS.ordering, maxItemQuantity: 50 },
        rowVersion: 3,
        updatedBy: { id: ADMIN_ID, name: 'Quản trị Mẫu' },
        updatedAt: UPDATED_AT,
      });
    });

    it('gives a seeded row (no editor) a null updatedBy', async () => {
      const { em } = fakeManager([orderingRow(1, null)]);

      expect((await serviceWith(em).get('ordering')).updatedBy).toBeNull();
    });
  });

  describe('typed getters', () => {
    it('read the defaults when no row exists', async () => {
      const { em } = fakeManager([null]);
      const service = serviceWith(em);

      expect(await service.getBusinessDayStart()).toBe('04:00');
      expect(await service.getOrderingLimits()).toEqual(SETTING_DEFAULTS.ordering);
      expect(await service.getBrand()).toEqual(SETTING_DEFAULTS.brand);
    });

    it('read the stored value when a row exists', async () => {
      const { em } = fakeManager([orderingRow(2, ADMIN_ID)]);

      expect((await serviceWith(em).getOrderingLimits()).maxItemQuantity).toBe(50);
    });
  });

  describe('write', () => {
    it('refuses an invalid value before any SQL', async () => {
      const { em, builder } = fakeManager([null]);
      const value = { ...SETTING_DEFAULTS.ordering, maxItemQuantity: 100 };

      const error = await apiErrorOf(serviceWith(em).write(em, 'ordering', value, 0, ADMIN_ID));

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.errors).toEqual([
        { field: 'ordering.maxItemQuantity', code: 'OUT_OF_RANGE', message: 'is out of range' },
      ]);
      expect(builder['execute']).not.toHaveBeenCalled();
    });

    it.each([-1, 1.5])('refuses an expected version of %s', async (expected) => {
      const { em, builder } = fakeManager([null]);

      const error = await apiErrorOf(
        serviceWith(em).write(em, 'ordering', SETTING_DEFAULTS.ordering, expected, ADMIN_ID),
      );

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(builder['execute']).not.toHaveBeenCalled();
    });

    it('inserts the first row for expected version 0, stored in snake_case', async () => {
      const { em, builder } = fakeManager([null], [{ row_version: 1, updated_at: WRITTEN_AT }]);

      const record = await serviceWith(em).write(
        em,
        'ordering',
        SETTING_DEFAULTS.ordering,
        0,
        ADMIN_ID,
      );

      expect(builder['insert']).toHaveBeenCalled();
      expect(builder['orIgnore']).toHaveBeenCalled();
      expect(builder['values']).toHaveBeenCalledWith({
        key: 'ordering',
        value: toOrderingStored(SETTING_DEFAULTS.ordering),
        updatedBy: ADMIN_ID,
      });
      expect(record).toEqual({
        value: SETTING_DEFAULTS.ordering,
        rowVersion: 1,
        updatedBy: { id: ADMIN_ID, name: 'Quản trị Mẫu' },
        updatedAt: WRITTEN_AT,
      });
    });

    it('updates at the expected version and returns the version the trigger set', async () => {
      const { em, builder } = fakeManager([], [{ row_version: 4, updated_at: WRITTEN_AT }]);

      const record = await serviceWith(em).write(
        em,
        'ordering',
        SETTING_DEFAULTS.ordering,
        3,
        ADMIN_ID,
      );

      expect(builder['update']).toHaveBeenCalledWith(AppSetting);
      expect(builder['where']).toHaveBeenCalledWith('key = :key AND row_version = :expected', {
        key: 'ordering',
        expected: 3,
      });
      expect(record.rowVersion).toBe(4);
    });

    it('answers STALE_VERSION with the current state when the update matches no row', async () => {
      const { em } = fakeManager([orderingRow(5, OTHER_ADMIN_ID)], []);

      const error = await apiErrorOf(
        serviceWith(em).write(em, 'ordering', SETTING_DEFAULTS.ordering, 3, ADMIN_ID),
      );

      expect(error.code).toBe('STALE_VERSION');
      expect(error.extras).toEqual({
        current: {
          rowVersion: 5,
          updatedBy: { id: OTHER_ADMIN_ID, name: 'Quản trị Khác' },
          updatedAt: UPDATED_AT.toISOString(),
        },
      });
    });

    it('lets a concurrent first save lose with STALE_VERSION', async () => {
      // The insert hit the row that the other save committed: ON CONFLICT DO NOTHING, no row back.
      const { em } = fakeManager([orderingRow(1, OTHER_ADMIN_ID)], []);

      const error = await apiErrorOf(
        serviceWith(em).write(em, 'ordering', SETTING_DEFAULTS.ordering, 0, ADMIN_ID),
      );

      expect(error.code).toBe('STALE_VERSION');
      expect(error.extras).toMatchObject({ current: { rowVersion: 1 } });
    });

    it('answers STALE_VERSION for a version given to a key that has no row', async () => {
      const { em } = fakeManager([null], []);

      const error = await apiErrorOf(
        serviceWith(em).write(em, 'ordering', SETTING_DEFAULTS.ordering, 2, ADMIN_ID),
      );

      expect(error.code).toBe('STALE_VERSION');
      expect(error.extras).toEqual({
        current: { rowVersion: 0, updatedBy: null, updatedAt: null },
      });
    });
  });
});
