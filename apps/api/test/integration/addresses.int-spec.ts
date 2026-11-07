import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_SAVED_ADDRESSES } from '../../src/modules/users/addresses.service.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import {
  CHECK_VIOLATION,
  expectSqlState,
  openAppRole,
  openRoleClient,
} from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A2-T5, migration 0010_customer_addresses.sql and `/me/addresses`, end to end as kd_app against
// real PostgreSQL (testing-strategy "Authorization and ownership"). Each test boots its own app, so
// the per-IP sign-in counter starts empty. Provinces and wards are written by SQL as kd_migrator
// (apps/api may not import tools/seed); their codes and names are fictional (no official unit has
// codes 90 or 93). Phone numbers are well-formed but made up.

/** SQLSTATE `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';
/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

const CUSTOMER_ID = '01930000-0000-7000-8000-000000000f01';
const OTHER_CUSTOMER_ID = '01930000-0000-7000-8000-000000000f02';
const MISSING_ID = '01930000-0000-7000-8000-000000000fff';

const CUSTOMER_EMAIL = 'fixture-addresses@kd.example';
const OTHER_EMAIL = 'fixture-addresses-other@kd.example';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-passphrase';

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'Người dùng mẫu', 'vi', 'CUSTOMER', 'ACTIVE')`;

const INSERT_PROVINCES_SQL = `INSERT INTO public.provinces (code, names, type) VALUES
  ('90', '{"vi": "Mẫu Lâm", "vi_full": "Thành phố Mẫu Lâm"}', 'CITY'),
  ('93', '{"vi": "Đồng Mẫu", "vi_full": "Tỉnh Đồng Mẫu"}', 'PROVINCE')`;

const INSERT_WARDS_SQL = `INSERT INTO public.wards (code, province_code, names, type) VALUES
  ('90001', '90', '{"vi": "Bến Mẫu", "vi_full": "Phường Bến Mẫu"}', 'WARD'),
  ('90002', '90', '{"vi": "Ánh Mẫu", "vi_full": "Xã Ánh Mẫu"}', 'COMMUNE'),
  ('93001', '93', '{"vi": "Khác Mẫu", "vi_full": "Phường Khác Mẫu"}', 'WARD')`;

/** An address row as SQL, for the database-level checks; `$1` user, `$2` province, `$3` ward, `$4` note. */
const INSERT_ADDRESS_ROW_SQL = `INSERT INTO public.customer_addresses
  (user_id, label, recipient_name, phone, address_line, province_code, ward_code, location, note,
   is_default)
  VALUES ($1, 'Nhà', 'Người Nhận Mẫu', '+84901234567', '1 Đường Mẫu', $2, $3,
          ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326)::geography, $4, $5)
  RETURNING id`;

const VALID_BODY = {
  label: 'Nhà',
  recipientName: 'Người Nhận Mẫu',
  phone: '090 123 4567',
  addressLine: '1 Đường Mẫu',
  provinceCode: '90',
  wardCode: '90001',
  location: { lat: 10.7769, lng: 106.7009 },
} as const;

interface AddressBody {
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
  readonly wardCode: string | null;
  readonly deliveryNote: string | null;
  readonly location: { readonly lat: number; readonly lng: number };
}

interface AddressPageBody {
  readonly items: AddressBody[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

describe('customer addresses (migration 0010, /me/addresses, kd_app, real PostgreSQL)', () => {
  let passwordHash: string;
  let migrator: RoleClient;
  let appRole: RoleClient;
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeAll(async () => {
    passwordHash = await new PasswordHasher().hash(PASSPHRASE);
    migrator = await openRoleClient('kd_migrator');
    appRole = await openAppRole();
  });

  afterAll(async () => {
    await appRole.close();
    await migrator.close();
  });

  beforeEach(async () => {
    await truncateAll();
    await migrator.query(INSERT_PROVINCES_SQL);
    await migrator.query(INSERT_WARDS_SQL);
    testApp = await createTestApp();
    client = http(testApp.baseUrl);
    await query(INSERT_USER_SQL, [CUSTOMER_ID, CUSTOMER_EMAIL, passwordHash]);
    await query(INSERT_USER_SQL, [OTHER_CUSTOMER_ID, OTHER_EMAIL, passwordHash]);
  });

  afterEach(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  async function signIn(email = CUSTOMER_EMAIL): Promise<Record<string, string>> {
    const response = await client.post('/api/v1/auth/login', { email, password: PASSPHRASE });
    expect(response.status).toBe(200);
    const { accessToken } = response.body as { accessToken: string };
    return { authorization: `Bearer ${accessToken}` };
  }

  function create(headers: Record<string, string>, body: unknown): Promise<TestResponse> {
    return client.post('/api/v1/me/addresses', body, { headers });
  }

  async function created(headers: Record<string, string>, body: unknown): Promise<AddressBody> {
    const response = await create(headers, body);
    expect(response.status).toBe(201);
    return response.body as AddressBody;
  }

  function patch(
    headers: Record<string, string>,
    id: string,
    body: unknown,
  ): Promise<TestResponse> {
    return client.request(`/api/v1/me/addresses/${id}`, { method: 'PATCH', headers, body });
  }

  function remove(headers: Record<string, string>, id: string): Promise<TestResponse> {
    return client.request(`/api/v1/me/addresses/${id}`, { method: 'DELETE', headers });
  }

  async function list(headers: Record<string, string>, search = ''): Promise<AddressPageBody> {
    const response = await client.get(`/api/v1/me/addresses${search}`, { headers });
    expect(response.status).toBe(200);
    return response.body as AddressPageBody;
  }

  async function storedDefaults(userId = CUSTOMER_ID): Promise<string[]> {
    const rows = await query<{ id: string }>(
      `SELECT id FROM public.customer_addresses
        WHERE user_id = $1 AND is_default AND deleted_at IS NULL ORDER BY id`,
      [userId],
    );
    return rows.map((row) => row.id);
  }

  describe('CRUD', () => {
    it('needs a token', async () => {
      expect((await client.get('/api/v1/me/addresses')).status).toBe(401);
      expect((await client.post('/api/v1/me/addresses', VALID_BODY)).status).toBe(401);
    });

    it('creates, reads, lists, updates and soft-deletes an address of the token user', async () => {
      const headers = await signIn();

      const response = await create(headers, { ...VALID_BODY, deliveryNote: '  Gọi trước  ' });
      expect(response.status).toBe(201);
      const address = response.body as AddressBody;
      expect(address).toEqual({
        id: expect.any(String),
        label: 'Nhà',
        recipientName: 'Người Nhận Mẫu',
        phone: '+84901234567',
        addressLine: '1 Đường Mẫu',
        provinceCode: '90',
        wardCode: '90001',
        location: { lat: expect.any(Number), lng: expect.any(Number) },
        deliveryNote: 'Gọi trước',
        // The first address is not made the default on its own.
        isDefault: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const [stored] = await query<{ user_id: string; note: string; phone: string }>(
        'SELECT user_id, note, phone FROM public.customer_addresses WHERE id = $1',
        [address.id],
      );
      expect(stored).toEqual({ user_id: CUSTOMER_ID, note: 'Gọi trước', phone: '+84901234567' });

      const read = await client.get(`/api/v1/me/addresses/${address.id}`, { headers });
      expect(read.status).toBe(200);
      expect(read.body).toEqual(address);
      expect((await list(headers)).items).toEqual([address]);

      const updated = await patch(headers, address.id, {
        label: 'Công ty',
        wardCode: null,
        deliveryNote: null,
      });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({
        id: address.id,
        label: 'Công ty',
        wardCode: null,
        deliveryNote: null,
        addressLine: '1 Đường Mẫu',
      });

      const deleted = await remove(headers, address.id);
      expect(deleted.status).toBe(204);
      expect(deleted.body).toBeNull();
      expect((await client.get(`/api/v1/me/addresses/${address.id}`, { headers })).status).toBe(
        404,
      );
      expect((await patch(headers, address.id, { label: 'Lại' })).status).toBe(404);
      expect((await remove(headers, address.id)).status).toBe(404);
      expect(await list(headers)).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
      // A soft delete: the row stays, with deleted_at.
      const [kept] = await query<{ deleted: boolean }>(
        'SELECT deleted_at IS NOT NULL AS deleted FROM public.customer_addresses WHERE id = $1',
        [address.id],
      );
      expect(kept).toEqual({ deleted: true });
    });

    it('round-trips the coordinates within 1e-6 degrees', async () => {
      const headers = await signIn();
      const location = { lat: 10.776912345, lng: 106.700945678 };

      const address = await created(headers, { ...VALID_BODY, location });
      const read = (await client.get(`/api/v1/me/addresses/${address.id}`, { headers }))
        .body as AddressBody;

      for (const value of [address.location, read.location]) {
        expect(Math.abs(value.lat - location.lat)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(value.lng - location.lng)).toBeLessThanOrEqual(1e-6);
      }

      const moved = { lat: -33.8688197, lng: -151.2092955 };
      const patched = (await patch(headers, address.id, { location: moved })).body as AddressBody;
      expect(Math.abs(patched.location.lat - moved.lat)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(patched.location.lng - moved.lng)).toBeLessThanOrEqual(1e-6);
    });

    it('answers VALIDATION_FAILED for a malformed id', async () => {
      const headers = await signIn();

      const response = await client.get('/api/v1/me/addresses/not-a-uuid', { headers });

      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('validation', () => {
    it('refuses a phone that is not a Vietnamese mobile with INVALID_PHONE', async () => {
      const headers = await signIn();

      const response = await create(headers, { ...VALID_BODY, phone: '0281234567' });

      expect(response.status).toBe(400);
      expect(response.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'phone', code: 'INVALID_PHONE' }],
      });
      expect(JSON.stringify(response.body)).not.toContain('0281234567');
    });

    it('refuses an unknown province on provinceCode, and an unknown or foreign ward on wardCode', async () => {
      const headers = await signIn();

      const province = await create(headers, { ...VALID_BODY, provinceCode: '99', wardCode: null });
      expect(province.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'provinceCode', code: 'NOT_FOUND' }],
      });
      for (const wardCode of ['99999', '93001']) {
        const ward = await create(headers, { ...VALID_BODY, wardCode });
        expect(ward.status).toBe(400);
        expect(ward.problem).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'wardCode', code: 'NOT_FOUND' }],
        });
      }
      expect((await list(headers)).total).toBe(0);
    });

    it('checks a kept ward against a new province on PATCH', async () => {
      const headers = await signIn();
      const address = await created(headers, VALID_BODY);

      const kept = await patch(headers, address.id, { provinceCode: '93' });
      expect(kept.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'wardCode', code: 'NOT_FOUND' }],
      });

      const both = await patch(headers, address.id, { provinceCode: '93', wardCode: '93001' });
      expect(both.status).toBe(200);
      expect(both.body).toMatchObject({ provinceCode: '93', wardCode: '93001' });
    });

    it('refuses a delivery note over 200 characters with TOO_LONG and accepts 200', async () => {
      const headers = await signIn();

      const tooLong = await create(headers, { ...VALID_BODY, deliveryNote: 'a'.repeat(201) });
      expect(tooLong.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'deliveryNote', code: 'TOO_LONG' }],
      });
      expect((await create(headers, { ...VALID_BODY, deliveryNote: 'a'.repeat(200) })).status).toBe(
        201,
      );
    });

    it('requires the pin and keeps coordinates out of the error body', async () => {
      const headers = await signIn();
      const missing = await create(headers, { ...VALID_BODY, location: undefined });
      expect(missing.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'location', code: 'REQUIRED' }],
      });

      const outOfRange = await create(headers, {
        ...VALID_BODY,
        location: { lat: 95.123456, lng: -181.654321 },
      });
      expect(outOfRange.status).toBe(400);
      expect(outOfRange.problem?.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'location.lat', code: 'OUT_OF_RANGE' }),
          expect.objectContaining({ field: 'location.lng', code: 'OUT_OF_RANGE' }),
        ]),
      );
      const text = JSON.stringify(outOfRange.body);
      expect(text).not.toContain('95.123456');
      expect(text).not.toContain('181.654321');

      const nullPin = await patch(headers, (await created(headers, VALID_BODY)).id, {
        location: null,
      });
      expect(nullPin.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'location', code: 'REQUIRED' }],
      });
    });

    it('refuses a user id in the body', async () => {
      const headers = await signIn();

      const response = await create(headers, { ...VALID_BODY, userId: OTHER_CUSTOMER_ID });

      expect(response.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'userId', code: 'INVALID' }],
      });
    });
  });

  describe('default address', () => {
    it('moves the default, lists it first, and chooses none when it is deleted', async () => {
      const headers = await signIn();
      const first = await created(headers, { ...VALID_BODY, label: 'Một', isDefault: true });
      const second = await created(headers, { ...VALID_BODY, label: 'Hai' });
      const third = await created(headers, { ...VALID_BODY, label: 'Ba', isDefault: true });

      expect(await storedDefaults()).toEqual([third.id]);
      // The default first, then the newest.
      expect((await list(headers)).items.map((item) => item.label)).toEqual(['Ba', 'Hai', 'Một']);

      const switched = await patch(headers, first.id, { isDefault: true });
      expect(switched.body).toMatchObject({ isDefault: true });
      expect(await storedDefaults()).toEqual([first.id]);
      expect((await list(headers)).items.map((item) => item.label)).toEqual(['Một', 'Ba', 'Hai']);

      // Deleting the default chooses no other one (mobile G101).
      expect((await remove(headers, first.id)).status).toBe(204);
      expect(await storedDefaults()).toEqual([]);
      expect((await list(headers)).items.every((item) => !item.isDefault)).toBe(true);
      expect(second.isDefault).toBe(false);
    });

    it('keeps one default when two requests set one in parallel', async () => {
      const headers = await signIn();
      const existing = await created(headers, { ...VALID_BODY, label: 'Cũ' });

      const responses = await Promise.all([
        create(headers, { ...VALID_BODY, label: 'Song song 1', isDefault: true }),
        create(headers, { ...VALID_BODY, label: 'Song song 2', isDefault: true }),
        patch(headers, existing.id, { isDefault: true }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 201, 201]);
      expect(await storedDefaults()).toHaveLength(1);
    });

    it('refuses a second default in the database (partial unique index)', async () => {
      await appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '90', null, null, true]);

      await expectSqlState(
        appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '90', null, null, true]),
        UNIQUE_VIOLATION,
      );
      // Another user, or a deleted default, does not count.
      await appRole.query(INSERT_ADDRESS_ROW_SQL, [OTHER_CUSTOMER_ID, '90', null, null, true]);
      await appRole.query(
        `UPDATE public.customer_addresses SET deleted_at = now()
          WHERE user_id = $1 AND is_default`,
        [CUSTOMER_ID],
      );
      await appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '90', null, null, true]);
    });
  });

  describe('database rules', () => {
    it('ties the ward to the province with a composite foreign key', async () => {
      await appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '90', '90001', null, false]);
      await appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '93', null, null, false]);

      await expectSqlState(
        appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '90', '93001', null, false]),
        FOREIGN_KEY_VIOLATION,
      );
      await expectSqlState(
        appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '99', null, null, false]),
        FOREIGN_KEY_VIOLATION,
      );
    });

    it('checks the note length at 200 characters', async () => {
      await appRole.query(INSERT_ADDRESS_ROW_SQL, [
        CUSTOMER_ID,
        '90',
        null,
        'a'.repeat(200),
        false,
      ]);

      await expectSqlState(
        appRole.query(INSERT_ADDRESS_ROW_SQL, [CUSTOMER_ID, '90', null, 'a'.repeat(201), false]),
        CHECK_VIOLATION,
      );
    });

    it('moves updated_at on an edit', async () => {
      const [row] = await appRole.query<{ id: string }>(INSERT_ADDRESS_ROW_SQL, [
        CUSTOMER_ID,
        '90',
        null,
        null,
        false,
      ]);
      await migrator.query(
        `UPDATE public.customer_addresses SET created_at = created_at - interval '1 day',
                updated_at = updated_at - interval '1 day' WHERE id = $1`,
        [row?.id],
      );

      await appRole.query(`UPDATE public.customer_addresses SET label = 'Mới' WHERE id = $1`, [
        row?.id,
      ]);

      const [times] = await appRole.query<{ moved: boolean }>(
        `SELECT updated_at > created_at + interval '12 hours' AS moved
           FROM public.customer_addresses WHERE id = $1`,
        [row?.id],
      );
      expect(times).toEqual({ moved: true });
    });
  });

  describe(`limit of ${MAX_SAVED_ADDRESSES} saved addresses`, () => {
    it('refuses the next one with LIMIT_REACHED; a deleted address frees a slot', async () => {
      const headers = await signIn();
      const addresses: AddressBody[] = [];
      for (let index = 0; index < MAX_SAVED_ADDRESSES; index += 1) {
        addresses.push(await created(headers, { ...VALID_BODY, label: `Địa chỉ ${index + 1}` }));
      }

      const refused = await create(headers, { ...VALID_BODY, label: 'Thừa' });
      expect(refused.status).toBe(400);
      expect(refused.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'address', code: 'LIMIT_REACHED' }],
      });
      expect((await list(headers)).total).toBe(MAX_SAVED_ADDRESSES);

      // Another customer has their own limit.
      await created(await signIn(OTHER_EMAIL), VALID_BODY);

      expect((await remove(headers, addresses[0]?.id ?? MISSING_ID)).status).toBe(204);
      expect((await create(headers, { ...VALID_BODY, label: 'Thay thế' })).status).toBe(201);
      expect((await list(headers)).total).toBe(MAX_SAVED_ADDRESSES);
    });
  });

  describe('ownership', () => {
    it("answers NOT_FOUND for another customer's address on get, patch and delete, unchanged", async () => {
      const owner = await signIn(OTHER_EMAIL);
      const theirs = await created(owner, { ...VALID_BODY, label: 'Của người khác' });
      const headers = await signIn();

      const read = await client.get(`/api/v1/me/addresses/${theirs.id}`, { headers });
      const changed = await patch(headers, theirs.id, { label: 'Đã sửa', isDefault: true });
      const deleted = await remove(headers, theirs.id);

      for (const response of [read, changed, deleted]) {
        expect(response.status).toBe(404);
        expect(response.problem?.code).toBe('NOT_FOUND');
      }
      expect((await list(headers)).total).toBe(0);
      const [stored] = await query<{ label: string; deleted: boolean; is_default: boolean }>(
        `SELECT label, deleted_at IS NOT NULL AS deleted, is_default
           FROM public.customer_addresses WHERE id = $1`,
        [theirs.id],
      );
      expect(stored).toEqual({ label: 'Của người khác', deleted: false, is_default: false });
      expect((await client.get(`/api/v1/me/addresses/${MISSING_ID}`, { headers })).status).toBe(
        404,
      );
    });
  });

  describe('paging', () => {
    it('pages with page and pageSize and counts the total', async () => {
      const headers = await signIn();
      for (const label of ['Một', 'Hai', 'Ba']) {
        await created(headers, { ...VALID_BODY, label });
      }

      const first = await list(headers, '?page=1&pageSize=2');
      expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(first.items.map((item) => item.label)).toEqual(['Ba', 'Hai']);
      const second = await list(headers, '?page=2&pageSize=2');
      expect(second.items.map((item) => item.label)).toEqual(['Một']);
      expect((await list(headers, '?page=3&pageSize=2')).items).toEqual([]);

      const tooBig = await client.get('/api/v1/me/addresses?pageSize=51', { headers });
      expect(tooBig.problem).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'pageSize', code: 'OUT_OF_RANGE' }],
      });
    });
  });

  describe('kd_app grants', () => {
    it('has SELECT, INSERT and UPDATE, and no DELETE or TRUNCATE', async () => {
      // One privilege per call: with a list, has_table_privilege is true when any one is held.
      const privileges = await appRole.query<{ privilege: string; held: boolean }>(
        `SELECT p.privilege, has_table_privilege('public.customer_addresses', p.privilege) AS held
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
          ORDER BY p.privilege`,
      );

      expect(
        Object.fromEntries(privileges.map(({ privilege, held }) => [privilege, held])),
      ).toEqual({ DELETE: false, INSERT: true, SELECT: true, TRUNCATE: false, UPDATE: true });
      const [row] = await appRole.query<{ id: string }>(INSERT_ADDRESS_ROW_SQL, [
        CUSTOMER_ID,
        '90',
        null,
        null,
        false,
      ]);
      await appRole.expectPermissionDenied('DELETE FROM public.customer_addresses WHERE id = $1', [
        row?.id,
      ]);
      await appRole.expectPermissionDenied('TRUNCATE public.customer_addresses');
    });
  });
});
