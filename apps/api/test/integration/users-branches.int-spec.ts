import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Branch } from '../../src/modules/branches/entities/branch.entity.js';
import { StaffBranch } from '../../src/modules/users/entities/staff-branch.entity.js';
import { User } from '../../src/modules/users/entities/user.entity.js';
import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppDataSource,
  openAppRole,
  openRoleClient,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0007_users_branches_staff.sql (A1-T3). Fictional data only.

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';
/** SQLSTATE `foreign_key_violation`: a missing referenced row, or a delete under NO ACTION. */
const FOREIGN_KEY_VIOLATION = '23503';
/** SQLSTATE `restrict_violation`: a delete refused by ON DELETE RESTRICT. */
const RESTRICT_VIOLATION = '23001';
/** SQLSTATE `invalid_text_representation`: a value outside an enum. */
const INVALID_TEXT_REPRESENTATION = '22P02';
/** A well-formed id that no row has. */
const MISSING_ID = '01900000-0000-7000-8000-000000000000';
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A valid branch, as SQL column values; `location` is written separately. */
const BRANCH_ROW: Readonly<Record<string, unknown>> = {
  code: 'KD',
  slug: 'chi-nhanh-mau',
  name: 'Chi nhánh Mẫu',
  address_line: '1 Đường Mẫu',
  province_code: '79',
  phone: '+84000000001',
  status: 'ACTIVE',
  accepts_pickup: true,
  accepts_delivery: false,
  accepts_reservations: false,
  default_prep_minutes: 15,
  order_cutoff_minutes: 30,
  reservation_slot_step_minutes: 15,
  reservation_max_party: 8,
  reservation_lead_minutes: 60,
  reservation_max_days_ahead: 30,
  sort_order: 0,
};

/** A valid customer, as SQL column values. */
const USER_ROW: Readonly<Record<string, unknown>> = {
  email: 'khach@kd.example',
  display_name: 'Khách Mẫu',
  locale: 'vi',
  role: 'CUSTOMER',
  status: 'ACTIVE',
};

async function insertRow(
  client: RoleClient,
  table: 'branches' | 'users',
  values: Readonly<Record<string, unknown>>,
): Promise<string> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  if (table === 'branches') {
    columns.push('location');
    placeholders.push('ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326)::geography');
  }
  const rows = await client.query<{ id: string }>(
    `INSERT INTO public.${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    Object.values(values),
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`no id returned for ${table}`);
  }
  return id;
}

function insertBranch(
  client: RoleClient,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return insertRow(client, 'branches', { ...BRANCH_ROW, ...overrides });
}

function insertUser(client: RoleClient, overrides: Record<string, unknown> = {}): Promise<string> {
  return insertRow(client, 'users', { ...USER_ROW, ...overrides });
}

describe('users, branches and staff_branches (migration 0007)', () => {
  let app: RoleClient;
  let migrator: RoleClient;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await openAppRole();
    migrator = await openRoleClient('kd_migrator');
    dataSource = await openAppDataSource();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await migrator.close();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('branches CHECKs', () => {
    it('accepts a valid branch', async () => {
      expect(await insertBranch(app)).toMatch(UUID_FORMAT);
    });

    it.each([
      ['a lower-case code', { code: 'kd' }],
      ['a one-letter code', { code: 'K' }],
      ['a five-letter code', { code: 'KDKDK' }],
      ['a code with a digit', { code: 'K1' }],
      ['a phone outside E.164', { phone: '0280000001' }],
      ['a description without vi', { description: '{"en": "Sample"}' }],
      ['a description that is not an object', { description: '["vi"]' }],
      ['a negative prep time', { default_prep_minutes: -1 }],
      ['a negative order cutoff', { order_cutoff_minutes: -1 }],
      ['a reservation of 15 minutes', { reservation_duration_minutes: 15 }],
      ['a reservation of 245 minutes', { reservation_duration_minutes: 245 }],
      ['a reservation of 100 minutes (not a step of 15)', { reservation_duration_minutes: 100 }],
      ['a slot step of 20', { reservation_slot_step_minutes: 20 }],
      ['a max party of 0', { reservation_max_party: 0 }],
      ['a lead time of 1441 minutes', { reservation_lead_minutes: 1441 }],
      ['a negative lead time', { reservation_lead_minutes: -1 }],
      ['0 days ahead', { reservation_max_days_ahead: 0 }],
      ['91 days ahead', { reservation_max_days_ahead: 91 }],
      ['an http website', { website_url: 'http://kd.example' }],
      ['a website of 256 characters', { website_url: `https://${'a'.repeat(248)}` }],
      ['a pause message of 201 characters', { pause_message: 'a'.repeat(201) }],
      ['a negative review count', { review_count: -1 }],
      ['a negative rating sum', { rating_sum: -1 }],
    ])('rejects %s', async (_case, overrides) => {
      await expectSqlState(insertBranch(app, overrides), CHECK_VIOLATION);
    });

    it.each([
      ['a reservation of 30 minutes', { reservation_duration_minutes: 30 }],
      ['a reservation of 240 minutes', { reservation_duration_minutes: 240 }],
      ['a slot step of 30', { reservation_slot_step_minutes: 30 }],
      ['a lead time of 0', { reservation_lead_minutes: 0 }],
      ['a lead time of 1440', { reservation_lead_minutes: 1440 }],
      ['90 days ahead', { reservation_max_days_ahead: 90 }],
      ['a description with vi and en', { description: '{"vi": "Mẫu", "en": "Sample"}' }],
      ['a website of 255 characters', { website_url: `https://${'a'.repeat(247)}` }],
      ['a pause message of 200 characters', { pause_message: 'a'.repeat(200) }],
    ])('accepts %s', async (_case, overrides) => {
      expect(await insertBranch(app, overrides)).toMatch(UUID_FORMAT);
    });

    it('defaults the reservation duration to 90 and the counters to 0', async () => {
      const id = await insertBranch(app);
      const rows = await app.query(
        `SELECT reservation_duration_minutes, review_count, rating_sum, row_version
           FROM public.branches WHERE id = $1`,
        [id],
      );

      expect(rows).toEqual([
        { reservation_duration_minutes: 90, review_count: 0, rating_sum: 0, row_version: 1 },
      ]);
    });

    it('rejects a status outside the enum', async () => {
      await expectSqlState(insertBranch(app, { status: 'OPEN' }), INVALID_TEXT_REPRESENTATION);
    });

    it('keeps code and slug unique', async () => {
      await insertBranch(app);

      await expectSqlState(insertBranch(app, { slug: 'khac' }), UNIQUE_VIOLATION);
      await expectSqlState(insertBranch(app, { code: 'KH' }), UNIQUE_VIOLATION);
    });
  });

  describe('users CHECKs', () => {
    it('accepts a valid customer', async () => {
      expect(await insertUser(app)).toMatch(UUID_FORMAT);
    });

    it.each([
      ['a display name of 61 characters', { display_name: 'a'.repeat(61) }],
      ['a phone in national form', { phone: '0900000001' }],
      ['a phone with a leading +0', { phone: '+0900000001' }],
      ['a negative failed_login_count', { failed_login_count: -1 }],
      ['an INVITED customer', { status: 'INVITED' }],
    ])('rejects %s', async (_case, overrides) => {
      await expectSqlState(insertUser(app, overrides), CHECK_VIOLATION);
    });

    it.each([
      ['a role', { role: 'USER' }],
      ['a status', { status: 'PENDING' }],
    ])('rejects %s outside its enum', async (_case, overrides) => {
      await expectSqlState(insertUser(app, overrides), INVALID_TEXT_REPRESENTATION);
    });

    it.each(['STAFF', 'MANAGER', 'ADMIN'])('accepts an INVITED %s', async (role) => {
      expect(await insertUser(app, { role, status: 'INVITED' })).toMatch(UUID_FORMAT);
    });

    it('accepts a display name of 60 characters and an E.164 phone', async () => {
      expect(
        await insertUser(app, { display_name: 'a'.repeat(60), phone: '+84000000001' }),
      ).toMatch(UUID_FORMAT);
    });

    it('treats emails that differ only in case as the same account (citext)', async () => {
      const id = await insertUser(app, { email: 'A@kd.example' });

      await expectSqlState(insertUser(app, { email: 'a@KD.example' }), UNIQUE_VIOLATION);
      const rows = await app.query('SELECT id FROM public.users WHERE email = $1', [
        'a@kd.EXAMPLE',
      ]);
      expect(rows).toEqual([{ id }]);
    });
  });

  describe('triggers', () => {
    it('bumps the branch row_version and updated_at on an edit, not on a counter update', async () => {
      const id = await insertBranch(app);
      // updated_at is not an editable column, so this sets it without firing a trigger.
      await app.query(
        "UPDATE public.branches SET updated_at = now() - interval '1 hour' WHERE id = $1",
        [id],
      );
      const [before] = await app.query<{ updated_at: Date }>(
        'SELECT updated_at FROM public.branches WHERE id = $1',
        [id],
      );

      // The trigger owns the counter: the value the statement sets is overwritten.
      await app.query(
        "UPDATE public.branches SET name = 'Chi nhánh Mới', row_version = 100 WHERE id = $1",
        [id],
      );
      const [edited] = await app.query<{ row_version: number; updated_at: Date }>(
        'SELECT row_version, updated_at FROM public.branches WHERE id = $1',
        [id],
      );
      expect(edited?.row_version).toBe(2);
      expect(edited?.updated_at.getTime()).toBeGreaterThan(before?.updated_at.getTime() ?? 0);

      await app.query(
        'UPDATE public.branches SET review_count = review_count + 1, rating_sum = rating_sum + 5 WHERE id = $1',
        [id],
      );
      const [counted] = await app.query<{
        row_version: number;
        updated_at: Date;
        review_count: number;
      }>('SELECT row_version, updated_at, review_count FROM public.branches WHERE id = $1', [id]);
      expect(counted).toEqual({ row_version: 2, updated_at: edited?.updated_at, review_count: 1 });
    });

    it('moves the user updated_at on a profile edit, not on sign-in bookkeeping', async () => {
      const id = await insertUser(app);
      const rewind = (): Promise<unknown> =>
        app.query("UPDATE public.users SET updated_at = now() - interval '1 hour' WHERE id = $1", [
          id,
        ]);
      const updatedAt = async (): Promise<number> => {
        const [row] = await app.query<{ updated_at: Date }>(
          'SELECT updated_at FROM public.users WHERE id = $1',
          [id],
        );
        return row?.updated_at.getTime() ?? 0;
      };

      await rewind();
      const rewound = await updatedAt();
      await app.query(
        'UPDATE public.users SET failed_login_count = 1, locked_until = now(), last_login_at = now() WHERE id = $1',
        [id],
      );
      expect(await updatedAt()).toBe(rewound);

      await app.query("UPDATE public.users SET display_name = 'Khách Mới' WHERE id = $1", [id]);
      expect(await updatedAt()).toBeGreaterThan(rewound);
    });
  });

  describe('foreign keys', () => {
    it('declares every new foreign key with its delete rule', async () => {
      const rows = await app.query<{ conname: string; confdeltype: string }>(
        `SELECT conname::text AS conname, confdeltype::text AS confdeltype
           FROM pg_constraint
          WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND conname = ANY($1)
          ORDER BY conname`,
        [
          [
            'audit_logs_actor_user_fkey',
            'audit_logs_branch_fkey',
            'branches_updated_by_fkey',
            'idempotency_keys_actor_fkey',
            'outbox_events_audience_user_fkey',
            'outbox_events_branch_fkey',
            'staff_branches_branch_fkey',
            'staff_branches_user_fkey',
            'users_preferred_branch_fkey',
          ],
        ],
      );

      // r = RESTRICT, c = CASCADE, n = SET NULL.
      expect(rows).toEqual([
        { conname: 'audit_logs_actor_user_fkey', confdeltype: 'r' },
        { conname: 'audit_logs_branch_fkey', confdeltype: 'r' },
        { conname: 'branches_updated_by_fkey', confdeltype: 'r' },
        { conname: 'idempotency_keys_actor_fkey', confdeltype: 'r' },
        { conname: 'outbox_events_audience_user_fkey', confdeltype: 'r' },
        { conname: 'outbox_events_branch_fkey', confdeltype: 'r' },
        { conname: 'staff_branches_branch_fkey', confdeltype: 'c' },
        { conname: 'staff_branches_user_fkey', confdeltype: 'r' },
        { conname: 'users_preferred_branch_fkey', confdeltype: 'n' },
      ]);
    });

    it('checks outbox_events.branch_id and audience_user_id', async () => {
      const branchId = await insertBranch(app);
      const userId = await insertUser(app);
      const insert = (
        audience: string,
        branch: string | null,
        user: string | null,
      ): Promise<unknown> =>
        app.query(
          `INSERT INTO public.outbox_events (type, entity_type, entity_id, audience, branch_id, audience_user_id)
           VALUES ('order.placed', 'ORDER', 'kd-test', $1, $2, $3)`,
          [audience, branch, user],
        );

      await expectSqlState(insert('BRANCH_STAFF', MISSING_ID, null), FOREIGN_KEY_VIOLATION);
      await expectSqlState(insert('USER', null, MISSING_ID), FOREIGN_KEY_VIOLATION);
      await insert('BRANCH_STAFF', branchId, null);
      await insert('USER', null, userId);
    });

    it('checks audit_logs.actor_user_id and branch_id', async () => {
      const branchId = await insertBranch(app);
      const userId = await insertUser(app);
      const insert = (actor: string | null, branch: string | null): Promise<unknown> =>
        app.query(
          `INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, branch_id)
           VALUES ($1, 'user.create', 'USER', 'kd-test', $2)`,
          [actor, branch],
        );

      await expectSqlState(insert(MISSING_ID, null), FOREIGN_KEY_VIOLATION);
      await expectSqlState(insert(null, MISSING_ID), FOREIGN_KEY_VIOLATION);
      await insert(userId, branchId);
    });

    it('checks idempotency_keys.actor_id', async () => {
      const userId = await insertUser(app);
      const insert = (actor: string): Promise<unknown> =>
        app.query(
          `INSERT INTO public.idempotency_keys (scope, actor_id, key, request_hash, expires_at)
           VALUES ('orders.create', $1, 'kd-test-key', repeat('a', 64), now() + interval '1 day')`,
          [actor],
        );

      await expectSqlState(insert(MISSING_ID), FOREIGN_KEY_VIOLATION);
      await insert(userId);
    });

    it('checks branches.updated_by and users.preferred_branch_id', async () => {
      await expectSqlState(insertBranch(app, { updated_by: MISSING_ID }), FOREIGN_KEY_VIOLATION);
      await expectSqlState(
        insertUser(app, { preferred_branch_id: MISSING_ID }),
        FOREIGN_KEY_VIOLATION,
      );
    });

    it('cascades a branch delete to staff_branches and clears the preferred branch', async () => {
      const branchId = await insertBranch(app);
      const staffId = await insertUser(app, {
        email: 'nhanvien@kd.example',
        role: 'STAFF',
        preferred_branch_id: branchId,
      });
      await app.query('INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)', [
        staffId,
        branchId,
      ]);

      // kd_app has no DELETE on branches: a hard delete is a maintenance operation.
      await migrator.query('DELETE FROM public.branches WHERE id = $1', [branchId]);

      expect(await app.query('SELECT * FROM public.staff_branches')).toEqual([]);
      expect(
        await app.query('SELECT preferred_branch_id FROM public.users WHERE id = $1', [staffId]),
      ).toEqual([{ preferred_branch_id: null }]);
    });

    it('refuses to delete a user who has a branch assignment', async () => {
      const branchId = await insertBranch(app);
      const staffId = await insertUser(app, { email: 'nhanvien@kd.example', role: 'STAFF' });
      await app.query('INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)', [
        staffId,
        branchId,
      ]);

      await expectSqlState(
        migrator.query('DELETE FROM public.users WHERE id = $1', [staffId]),
        RESTRICT_VIOLATION,
      );
    });

    it('keeps one assignment per user and branch', async () => {
      const branchId = await insertBranch(app);
      const staffId = await insertUser(app, { email: 'nhanvien@kd.example', role: 'STAFF' });
      const assign = (): Promise<unknown> =>
        app.query('INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)', [
          staffId,
          branchId,
        ]);

      await assign();
      await expectSqlState(assign(), UNIQUE_VIOLATION);
    });
  });

  describe('kd_app grants', () => {
    it('refuses DELETE and TRUNCATE on users and branches', async () => {
      const branchId = await insertBranch(app);
      const userId = await insertUser(app);

      await app.expectPermissionDenied('DELETE FROM public.users WHERE id = $1', [userId]);
      await app.expectPermissionDenied('DELETE FROM public.branches WHERE id = $1', [branchId]);
      await app.expectPermissionDenied('TRUNCATE public.users');
      await app.expectPermissionDenied('TRUNCATE public.branches');
    });

    it('grants exactly the privileges of the data model', async () => {
      // One privilege per call: with a list, has_table_privilege is true when any one is held.
      const privileges = await app.query<{ name: string; privilege: string; held: boolean }>(
        `SELECT t.name, p.privilege, has_table_privilege('public.' || t.name, p.privilege) AS held
           FROM unnest(ARRAY['users', 'branches', 'staff_branches']) AS t(name)
          CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
          ORDER BY t.name, p.privilege`,
      );
      const held = Object.fromEntries(
        privileges.map(({ name, privilege, held: has }) => [`${name} ${privilege}`, has]),
      );
      expect(held).toEqual({
        'branches DELETE': false,
        'branches INSERT': true,
        'branches SELECT': true,
        'branches TRUNCATE': false,
        'branches UPDATE': true,
        'staff_branches DELETE': true,
        'staff_branches INSERT': true,
        'staff_branches SELECT': true,
        'staff_branches TRUNCATE': false,
        'staff_branches UPDATE': true,
        'users DELETE': false,
        'users INSERT': true,
        'users SELECT': true,
        'users TRUNCATE': false,
        'users UPDATE': true,
      });

      const branchId = await insertBranch(app);
      const staffId = await insertUser(app, { email: 'nhanvien@kd.example', role: 'MANAGER' });
      await app.query('INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)', [
        staffId,
        branchId,
      ]);
      const deleted = await app.query(
        'DELETE FROM public.staff_branches WHERE user_id = $1 AND branch_id = $2 RETURNING user_id',
        [staffId, branchId],
      );
      expect(deleted).toEqual([{ user_id: staffId }]);
    });
  });

  describe('entities (TypeORM 1.1.2)', () => {
    const LOCATION = { type: 'Point' as const, coordinates: [106.7009, 10.7769] };

    function branchFields(): Partial<Branch> {
      return {
        code: 'KD',
        slug: 'chi-nhanh-mau',
        name: 'Chi nhánh Mẫu',
        description: { vi: 'Chi nhánh mẫu', en: 'Sample branch' },
        addressLine: '1 Đường Mẫu',
        provinceCode: '79',
        location: LOCATION,
        phone: '+84000000001',
        status: 'ACTIVE',
        acceptsPickup: true,
        acceptsDelivery: false,
        acceptsReservations: true,
        defaultPrepMinutes: 15,
        orderCutoffMinutes: 30,
        reservationSlotStepMinutes: 30,
        reservationMaxParty: 6,
        reservationLeadMinutes: 120,
        reservationMaxDaysAhead: 14,
        sortOrder: 1,
      };
    }

    it('writes and reads geography(Point, 4326) and returns the database id', async () => {
      const repository = dataSource.getRepository(Branch);

      const result = await repository.insert(branchFields());
      const id = (result.identifiers[0] as { id?: unknown } | undefined)?.id;
      expect(id).toMatch(UUID_FORMAT);

      const loaded = await repository.findOneByOrFail({ id: id as string });
      expect(loaded.location).toEqual(LOCATION);
      expect(loaded).toMatchObject({
        reservationDurationMinutes: 90,
        reviewCount: 0,
        rowVersion: 1,
        description: { vi: 'Chi nhánh mẫu', en: 'Sample branch' },
        wardCode: null,
        deletedAt: null,
      });

      const [stored] = await app.query(
        `SELECT ST_SRID(location::geometry) AS srid, ST_X(location::geometry) AS x,
                ST_Y(location::geometry) AS y
           FROM public.branches WHERE id = $1`,
        [id],
      );
      expect(stored).toEqual({ srid: 4326, x: 106.7009, y: 10.7769 });

      const moved = { type: 'Point' as const, coordinates: [105.8542, 21.0285] };
      await repository.update({ id: id as string }, { location: moved });
      const reloaded = await repository.findOneByOrFail({ id: id as string });
      expect(reloaded.location).toEqual(moved);
      expect(reloaded.rowVersion).toBe(2);
    });

    it('maps users and staff_branches with their relations', async () => {
      const branchId = (await dataSource.getRepository(Branch).insert(branchFields()))
        .identifiers[0]?.['id'] as string;
      const userId = (
        await dataSource.getRepository(User).insert({
          email: 'QuanLy@kd.example',
          displayName: 'Quản lý Mẫu',
          locale: 'vi',
          role: 'MANAGER',
          status: 'ACTIVE',
          preferredBranchId: branchId,
        })
      ).identifiers[0]?.['id'] as string;
      await dataSource.getRepository(StaffBranch).insert({ userId, branchId });

      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ email: 'quanly@KD.example' });
      expect(user).toMatchObject({
        id: userId,
        email: 'QuanLy@kd.example',
        role: 'MANAGER',
        status: 'ACTIVE',
        failedLoginCount: 0,
        passwordHash: null,
        preferredBranchId: branchId,
      });

      const assignment = await dataSource.getRepository(StaffBranch).findOneOrFail({
        where: { userId, branchId },
        relations: { user: true, branch: true },
      });
      expect(assignment.user?.id).toBe(userId);
      expect(assignment.branch?.location).toEqual(LOCATION);
    });
  });
});
