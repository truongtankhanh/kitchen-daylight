import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SETTING_DEFAULTS } from '../../src/modules/settings/settings-defaults.js';
import { SettingsService } from '../../src/modules/settings/settings.service.js';
import type { SettingKey } from '../../src/modules/settings/schema/setting-rules.js';
import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppDataSource,
  openAppRole,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0011_app_settings.sql and SettingsService (A4-T1). Fictional data only.

/** SQLSTATE `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';
/** A well-formed id that no row has. */
const MISSING_ID = '01900000-0000-7000-8000-000000000000';

const ORDERING = SETTING_DEFAULTS.ordering;

describe('app_settings (migration 0011) and SettingsService', () => {
  let app: RoleClient;
  let dataSource: DataSource;
  let service: SettingsService;
  let adminId: string;

  beforeAll(async () => {
    app = await openAppRole();
    dataSource = await openAppDataSource();
    service = new SettingsService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    const rows = await app.query<{ id: string }>(
      `INSERT INTO public.users (email, display_name, locale, role, status)
       VALUES ('quan-tri@kd.example', 'Quản trị Mẫu', 'vi', 'ADMIN', 'ACTIVE') RETURNING id`,
    );
    adminId = rows[0]?.id ?? '';
  });

  function save(key: SettingKey, value: unknown, expected: number) {
    return dataSource.transaction((manager) =>
      service.write(manager, key, value, expected, adminId),
    );
  }

  async function storedVersions(): Promise<Record<string, number>> {
    const rows = await app.query<{ key: string; row_version: number }>(
      'SELECT key, row_version FROM public.app_settings ORDER BY key',
    );
    return Object.fromEntries(rows.map((row) => [row.key, row.row_version]));
  }

  describe('reading', () => {
    it('reads a missing key as its code default with rowVersion 0', async () => {
      expect(await service.get('ordering')).toEqual({
        value: ORDERING,
        rowVersion: 0,
        updatedBy: null,
        updatedAt: null,
      });
      expect(await service.getBusinessDayStart()).toBe('04:00');
      expect(await storedVersions()).toEqual({});
    });
  });

  describe('saving', () => {
    it('inserts the first save at row_version 1 with the editor, in snake_case', async () => {
      const record = await save('ordering', { ...ORDERING, maxItemQuantity: 40 }, 0);

      expect(record).toMatchObject({
        value: { maxItemQuantity: 40 },
        rowVersion: 1,
        updatedBy: { id: adminId, name: 'Quản trị Mẫu' },
      });
      const rows = await app.query<Record<string, unknown>>(
        `SELECT value->>'max_item_quantity' AS max_item_quantity,
                value->'board_thresholds'->'accept'->>'warn' AS accept_warn,
                value ? 'maxItemQuantity' AS has_camel_case,
                updated_by
           FROM public.app_settings WHERE key = 'ordering'`,
      );
      expect(rows).toEqual([
        { max_item_quantity: '40', accept_warn: '5', has_camel_case: false, updated_by: adminId },
      ]);
      expect(await service.get('ordering')).toMatchObject({
        value: { ...ORDERING, maxItemQuantity: 40 },
        rowVersion: 1,
      });
    });

    it('stores a camelCase key under its snake_case storage key', async () => {
      await save('minAppVersion', { ios: '1.0.0', android: '1.0.1' }, 0);

      expect(await storedVersions()).toEqual({ min_app_version: 1 });
    });

    it('increments row_version per key on every save, never across keys', async () => {
      await save('ordering', ORDERING, 0);
      await save('ordering', { ...ORDERING, maxCartLines: 25 }, 1);
      await save('ordering', ORDERING, 2);
      await save('brand', SETTING_DEFAULTS.brand, 0);

      expect(await storedVersions()).toEqual({ ordering: 3, brand: 1 });
      expect((await service.get('ordering')).rowVersion).toBe(3);
      expect((await service.get('brand')).rowVersion).toBe(1);
    });

    it('moves row_version and updated_at by trigger, whatever the statement sets', async () => {
      await save('reports', SETTING_DEFAULTS.reports, 0);
      const [before] = await app.query<{ updated_at: Date }>(
        `SELECT updated_at FROM public.app_settings WHERE key = 'reports'`,
      );

      await app.query(
        `UPDATE public.app_settings SET value = value, row_version = 99 WHERE key = 'reports'`,
      );

      const [after] = await app.query<{ row_version: number; updated_at: Date }>(
        `SELECT row_version, updated_at FROM public.app_settings WHERE key = 'reports'`,
      );
      expect(after?.row_version).toBe(2);
      expect(after?.updated_at.getTime()).toBeGreaterThanOrEqual(before?.updated_at.getTime() ?? 0);
    });

    it('refuses a stale write and changes nothing', async () => {
      await save('ordering', ORDERING, 0);
      await save('ordering', { ...ORDERING, maxCartLines: 25 }, 1);

      await expect(save('ordering', { ...ORDERING, maxCartLines: 10 }, 1)).rejects.toMatchObject({
        code: 'STALE_VERSION',
        extras: {
          current: { rowVersion: 2, updatedBy: { id: adminId, name: 'Quản trị Mẫu' } },
        },
      });
      expect(await service.get('ordering')).toMatchObject({
        value: { maxCartLines: 25 },
        rowVersion: 2,
      });
    });

    it('lets a second first save of the same key lose with STALE_VERSION', async () => {
      await save('payment', SETTING_DEFAULTS.payment, 0);

      await expect(save('payment', SETTING_DEFAULTS.payment, 0)).rejects.toMatchObject({
        code: 'STALE_VERSION',
        extras: { current: { rowVersion: 1 } },
      });
      expect(await storedVersions()).toEqual({ payment: 1 });
    });

    it('lets one of two concurrent first saves win and the other lose', async () => {
      const results = await Promise.allSettled([
        save('featureFlags', { ...SETTING_DEFAULTS.featureFlags, loyalty: true }, 0),
        save('featureFlags', { ...SETTING_DEFAULTS.featureFlags, charts: true }, 0),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ code: 'STALE_VERSION' });
      expect(await storedVersions()).toEqual({ feature_flags: 1 });
    });

    it('refuses an invalid value and writes nothing', async () => {
      await expect(
        save('ordering', { ...ORDERING, autoCancelUnacceptedMinutes: 5 }, 0),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [
          { field: 'ordering.autoCancelUnacceptedMinutes', code: 'MUST_EXCEED_ACCEPT_LATE' },
        ],
      });
      expect(await storedVersions()).toEqual({});
    });
  });

  describe('constraints and grants', () => {
    it.each(['reservations', 'Brand', 'minAppVersion', 'tax'])(
      'refuses the key %s (CHECK app_settings_key_known)',
      async (key) => {
        await expectSqlState(
          app.query(`INSERT INTO public.app_settings (key, value) VALUES ($1, '{}')`, [key]),
          CHECK_VIOLATION,
        );
      },
    );

    it('accepts each of the eight keys', async () => {
      for (const key of [
        'brand',
        'reports',
        'min_app_version',
        'maintenance',
        'feature_flags',
        'payment',
        'ordering',
        'loyalty',
      ]) {
        await app.query(`INSERT INTO public.app_settings (key, value) VALUES ($1, '{}')`, [key]);
      }

      expect(Object.values(await storedVersions())).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it.each(['[]', '"on"', '1', 'null'])(
      'refuses a value %s that is not an object',
      async (value) => {
        await expectSqlState(
          app.query(`INSERT INTO public.app_settings (key, value) VALUES ('brand', $1::jsonb)`, [
            value,
          ]),
          CHECK_VIOLATION,
        );
      },
    );

    it('refuses an updated_by that is no user', async () => {
      await expectSqlState(
        app.query(
          `INSERT INTO public.app_settings (key, value, updated_by) VALUES ('brand', '{}', $1)`,
          [MISSING_ID],
        ),
        FOREIGN_KEY_VIOLATION,
      );
    });

    it('lets kd_app read, insert and update but never delete or truncate', async () => {
      await save('maintenance', SETTING_DEFAULTS.maintenance, 0);

      await app.expectPermissionDenied(`DELETE FROM public.app_settings WHERE key = 'maintenance'`);
      await app.expectPermissionDenied('TRUNCATE public.app_settings');
      expect(await storedVersions()).toEqual({ maintenance: 1 });
    });
  });
});
