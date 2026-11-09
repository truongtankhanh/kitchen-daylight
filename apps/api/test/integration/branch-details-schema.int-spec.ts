import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BranchOpeningPeriod } from '../../src/modules/branches/entities/branch-opening-period.entity.js';
import { BranchSpecialHours } from '../../src/modules/branches/entities/branch-special-hours.entity.js';
import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppDataSource,
  openAppRole,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0013_branch_details.sql (A5-T1). Fictional data only.

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';
/**
 * SQLSTATE `restrict_violation`: a delete refused by `ON DELETE RESTRICT`. PostgreSQL 18 raises
 * 23001 here, not 23503 (`foreign_key_violation`, NO ACTION), as the A1-T3 run showed.
 */
const RESTRICT_VIOLATION = '23001';

const BRANCH_ID = '01900000-0000-7000-8000-0000000000b1';
const OTHER_BRANCH_ID = '01900000-0000-7000-8000-0000000000b2';

type Table =
  | 'branch_opening_periods'
  | 'branch_special_hours'
  | 'delivery_zones'
  | 'amenities'
  | 'branch_amenities';

type Values = Readonly<Record<string, unknown>>;

const PERIOD_ROW: Values = {
  branch_id: BRANCH_ID,
  service: 'STORE',
  day_of_week: 1,
  open_time: '10:00',
  close_time: '14:00',
  closes_next_day: false,
};

const CLOSED_DAY_ROW: Values = {
  branch_id: BRANCH_ID,
  service: 'STORE',
  starts_on: '2027-02-05',
  ends_on: '2027-02-09',
  is_closed: true,
  note: 'Nghỉ Tết (nội bộ)',
  display_note: 'Nghỉ Tết',
};

const OPEN_DAY_ROW: Values = {
  branch_id: BRANCH_ID,
  service: 'STORE',
  starts_on: '2027-02-10',
  ends_on: '2027-02-10',
  is_closed: false,
  open_time: '08:00',
  close_time: '12:00',
  closes_next_day: false,
};

const ZONE_ROW: Values = {
  branch_id: BRANCH_ID,
  name: 'Vòng 1',
  radius_m: 3000,
  fee: 15000,
  min_order: 0,
  eta_minutes: 30,
  is_active: true,
};

const AMENITY_ROW: Values = {
  code: 'wifi',
  names: '{"vi": "Wifi miễn phí", "en": "Free wifi"}',
  icon: 'wifi',
};

describe('branch details schema (migration 0013)', () => {
  let app: RoleClient;
  let dataSource: DataSource;

  /** Inserts one row as `kd_app` and returns its `id` (undefined for `branch_amenities`). */
  async function insert(table: Table, values: Values): Promise<string | undefined> {
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const returning = table === 'branch_amenities' ? 'branch_id AS id' : 'id';
    const rows = await app.query<{ id: string }>(
      `INSERT INTO public.${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
       RETURNING ${returning}`,
      Object.values(values),
    );
    return rows[0]?.id;
  }

  async function insertId(table: Table, values: Values): Promise<string> {
    const id = await insert(table, values);
    if (id === undefined) {
      throw new Error(`no id returned for ${table}`);
    }
    return id;
  }

  beforeAll(async () => {
    app = await openAppRole();
    dataSource = await openAppDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_ID, OTHER_BRANCH_ID] });
  });

  describe('branch_opening_periods', () => {
    it.each([
      ['a day period', {}],
      ['Sunday (7)', { day_of_week: 7 }],
      [
        'a period past midnight',
        { open_time: '18:00', close_time: '02:00', closes_next_day: true },
      ],
      [
        'a period ending at midnight',
        { open_time: '18:00', close_time: '00:00', closes_next_day: true },
      ],
      ['a DELIVERY period', { service: 'DELIVERY' }],
    ])('accepts %s', async (_case, overrides) => {
      await expect(
        insertId('branch_opening_periods', { ...PERIOD_ROW, ...overrides }),
      ).resolves.toEqual(expect.any(String));
    });

    it.each([
      [
        'equal open and close times',
        { open_time: '10:00', close_time: '10:00', closes_next_day: true },
      ],
      ['closes_next_day on a day period', { closes_next_day: true }],
      ['no closes_next_day on a period past midnight', { open_time: '18:00', close_time: '02:00' }],
      ['day_of_week 0', { day_of_week: 0 }],
      ['day_of_week 8', { day_of_week: 8 }],
    ])('rejects %s', async (_case, overrides) => {
      await expectSqlState(
        insert('branch_opening_periods', { ...PERIOD_ROW, ...overrides }),
        CHECK_VIOLATION,
      );
    });

    it('maps time columns to strings through the entity', async () => {
      const id = await insertId('branch_opening_periods', PERIOD_ROW);

      const period = await dataSource.getRepository(BranchOpeningPeriod).findOneByOrFail({ id });

      expect(period).toMatchObject({
        branchId: BRANCH_ID,
        service: 'STORE',
        dayOfWeek: 1,
        openTime: '10:00:00',
        closeTime: '14:00:00',
        closesNextDay: false,
      });
    });
  });

  describe('branch_special_hours (api-divergences D-128)', () => {
    it.each([
      ['a closed range', CLOSED_DAY_ROW],
      ['an open day', OPEN_DAY_ROW],
      [
        'an open day past midnight',
        { ...OPEN_DAY_ROW, open_time: '18:00', close_time: '01:00', closes_next_day: true },
      ],
    ])('accepts %s', async (_case, values) => {
      await expect(insertId('branch_special_hours', values)).resolves.toEqual(expect.any(String));
    });

    it.each([
      ['ends_on before starts_on', { ...CLOSED_DAY_ROW, ends_on: '2027-02-04' }],
      ['a closed range with times', { ...OPEN_DAY_ROW, is_closed: true }],
      ['an open day without times', { ...CLOSED_DAY_ROW, is_closed: false }],
      ['an open day without closes_next_day', { ...OPEN_DAY_ROW, closes_next_day: null }],
      [
        'an open day with equal times',
        { ...OPEN_DAY_ROW, close_time: '08:00', closes_next_day: true },
      ],
      ['an open day with a wrong closes_next_day', { ...OPEN_DAY_ROW, closes_next_day: true }],
    ])('rejects %s', async (_case, values) => {
      await expectSqlState(insert('branch_special_hours', values), CHECK_VIOLATION);
    });

    it('maps date and time columns to strings through the entity', async () => {
      const id = await insertId('branch_special_hours', OPEN_DAY_ROW);

      const day = await dataSource.getRepository(BranchSpecialHours).findOneByOrFail({ id });

      expect(day).toMatchObject({
        startsOn: '2027-02-10',
        endsOn: '2027-02-10',
        isClosed: false,
        openTime: '08:00:00',
        closeTime: '12:00:00',
        closesNextDay: false,
        note: null,
        displayNote: null,
      });
    });
  });

  describe('delivery_zones', () => {
    it.each([
      ['a valid zone', {}],
      ['a free zone', { fee: 0 }],
      ['free_over above min_order', { min_order: 100000, free_over: 100001 }],
    ])('accepts %s', async (_case, overrides) => {
      await expect(insertId('delivery_zones', { ...ZONE_ROW, ...overrides })).resolves.toEqual(
        expect.any(String),
      );
    });

    it.each([
      ['a negative fee', { fee: -1 }],
      ['a radius of 0', { radius_m: 0 }],
      ['a negative radius', { radius_m: -1 }],
      ['a negative min_order', { min_order: -1 }],
      ['free_over equal to min_order', { min_order: 100000, free_over: 100000 }],
      ['free_over below min_order', { min_order: 100000, free_over: 50000 }],
      ['an eta of 0 minutes', { eta_minutes: 0 }],
    ])('rejects %s', async (_case, overrides) => {
      await expectSqlState(
        insert('delivery_zones', { ...ZONE_ROW, ...overrides }),
        CHECK_VIOLATION,
      );
    });

    it('refuses two active rings of one branch with the same radius', async () => {
      await insertId('delivery_zones', ZONE_ROW);

      await expectSqlState(
        insert('delivery_zones', { ...ZONE_ROW, name: 'Vòng trùng' }),
        UNIQUE_VIOLATION,
      );
    });

    it('accepts an inactive ring, or another branch, with the radius of an active one', async () => {
      await insertId('delivery_zones', ZONE_ROW);

      await insertId('delivery_zones', { ...ZONE_ROW, name: 'Vòng cũ', is_active: false });
      await insertId('delivery_zones', { ...ZONE_ROW, name: 'Vòng cũ 2', is_active: false });
      await insertId('delivery_zones', { ...ZONE_ROW, branch_id: OTHER_BRANCH_ID });

      const rows = await app.query<{ count: string }>(
        'SELECT count(*) FROM public.delivery_zones WHERE radius_m = $1',
        [ZONE_ROW['radius_m']],
      );
      expect(rows).toEqual([{ count: '4' }]);
    });

    it('bumps row_version and updated_at on an edit, whatever the statement sets', async () => {
      const id = await insertId('delivery_zones', {
        ...ZONE_ROW,
        updated_at: '2020-01-01T00:00:00Z',
      });

      const rows = await app.query<{ row_version: number; moved: boolean }>(
        `UPDATE public.delivery_zones SET fee = 20000, row_version = 99 WHERE id = $1
         RETURNING row_version, updated_at > '2020-01-01T00:00:00Z' AS moved`,
        [id],
      );

      expect(rows).toEqual([{ row_version: 2, moved: true }]);
    });
  });

  describe('amenities and branch_amenities', () => {
    it('accepts an amenity with a vi name', async () => {
      await expect(insertId('amenities', AMENITY_ROW)).resolves.toEqual(expect.any(String));
    });

    it.each([
      ['names without vi', '{"en": "Free wifi"}'],
      ['names that are an array holding vi', '["vi"]'],
    ])('rejects %s', async (_case, names) => {
      await expectSqlState(insert('amenities', { ...AMENITY_ROW, names }), CHECK_VIOLATION);
    });

    it('keeps code unique', async () => {
      await insertId('amenities', AMENITY_ROW);

      await expectSqlState(insert('amenities', AMENITY_ROW), UNIQUE_VIOLATION);
    });

    it('bumps row_version and updated_at on an edit, whatever the statement sets', async () => {
      const id = await insertId('amenities', {
        ...AMENITY_ROW,
        updated_at: '2020-01-01T00:00:00Z',
      });

      const rows = await app.query<{ row_version: number; moved: boolean }>(
        `UPDATE public.amenities SET icon = 'box', row_version = 99 WHERE id = $1
         RETURNING row_version, updated_at > '2020-01-01T00:00:00Z' AS moved`,
        [id],
      );

      expect(rows).toEqual([{ row_version: 2, moved: true }]);
    });

    it('refuses to delete an amenity that a branch uses', async () => {
      const amenityId = await insertId('amenities', AMENITY_ROW);
      await insert('branch_amenities', { branch_id: BRANCH_ID, amenity_id: amenityId });

      await expectSqlState(
        app.query('DELETE FROM public.amenities WHERE id = $1', [amenityId]),
        RESTRICT_VIOLATION,
      );
    });

    it('keeps one link per branch and amenity', async () => {
      const amenityId = await insertId('amenities', AMENITY_ROW);
      await insert('branch_amenities', { branch_id: BRANCH_ID, amenity_id: amenityId });

      await expectSqlState(
        insert('branch_amenities', { branch_id: BRANCH_ID, amenity_id: amenityId }),
        UNIQUE_VIOLATION,
      );
    });
  });

  describe('kd_app privileges', () => {
    it('deletes from each of the five tables', async () => {
      const amenityId = await insertId('amenities', AMENITY_ROW);
      const unusedAmenityId = await insertId('amenities', {
        ...AMENITY_ROW,
        code: 'parking',
        icon: 'car',
      });
      await insert('branch_amenities', { branch_id: BRANCH_ID, amenity_id: amenityId });
      const periodId = await insertId('branch_opening_periods', PERIOD_ROW);
      const dayId = await insertId('branch_special_hours', CLOSED_DAY_ROW);
      const zoneId = await insertId('delivery_zones', ZONE_ROW);

      const deletes: [string, unknown[]][] = [
        ['DELETE FROM public.branch_opening_periods WHERE id = $1 RETURNING id', [periodId]],
        ['DELETE FROM public.branch_special_hours WHERE id = $1 RETURNING id', [dayId]],
        ['DELETE FROM public.delivery_zones WHERE id = $1 RETURNING id', [zoneId]],
        [
          'DELETE FROM public.branch_amenities WHERE branch_id = $1 AND amenity_id = $2 RETURNING branch_id AS id',
          [BRANCH_ID, amenityId],
        ],
        ['DELETE FROM public.amenities WHERE id = $1 RETURNING id', [unusedAmenityId]],
      ];
      for (const [sql, parameters] of deletes) {
        expect(await app.query(sql, parameters)).toHaveLength(1);
      }
    });
  });
});
