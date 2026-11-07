import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expectSqlState, openAppRole, openRoleClient } from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0009_geography.sql and GET /provinces, /wards (A2-T3). The rows are written here by
// SQL as kd_migrator, not through `seed reference`: apps/api may not import tools/seed (decision
// 0003). Codes and names are fictional (no official unit has codes 90, 93 or 94).

/** SQLSTATE `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = '23503';
/** SQLSTATE `check_violation`. */
const CHECK_VIOLATION = '23514';
/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

const CACHE_CONTROL = 'public, max-age=86400';
const STRONG_ETAG = /^"[A-Za-z0-9_-]{43}"$/;

const INSERT_PROVINCES_SQL = `INSERT INTO public.provinces (code, names, type) VALUES
  ('90', '{"vi": "Mẫu Lâm", "vi_full": "Thành phố Mẫu Lâm"}', 'CITY'),
  ('93', '{"vi": "Đồng Mẫu", "vi_full": "Tỉnh Đồng Mẫu"}', 'PROVINCE'),
  ('94', '{"vi": "An Mẫu", "vi_full": "Tỉnh An Mẫu"}', 'PROVINCE')`;

// Province 90 has three units, inserted out of order; 93 has one; 94 has none.
const INSERT_WARDS_SQL = `INSERT INTO public.wards (code, province_code, names, type) VALUES
  ('90003', '90', '{"vi": "Đông Mẫu", "vi_full": "Xã Đông Mẫu"}', 'COMMUNE'),
  ('90001', '90', '{"vi": "Bến Mẫu", "vi_full": "Phường Bến Mẫu"}', 'WARD'),
  ('90002', '90', '{"vi": "Ánh Mẫu", "vi_full": "Đặc khu Ánh Mẫu"}', 'SPECIAL_ZONE'),
  ('93001', '93', '{"vi": "Khác Mẫu", "vi_full": "Phường Khác Mẫu"}', 'WARD')`;

/** A valid branch as SQL; `province_code` and `ward_code` come from the test. */
function insertBranchSql(provinceCode: string, wardCode: string | null): [string, unknown[]] {
  return [
    `INSERT INTO public.branches
       (code, slug, name, address_line, province_code, ward_code, location, phone, status,
        accepts_pickup, accepts_delivery, accepts_reservations, default_prep_minutes,
        order_cutoff_minutes, reservation_slot_step_minutes, reservation_max_party,
        reservation_lead_minutes, reservation_max_days_ahead, sort_order)
     VALUES ('KD', 'chi-nhanh-mau', 'Chi nhánh Mẫu', '1 Đường Mẫu', $1, $2,
             ST_SetSRID(ST_MakePoint(106.7, 10.77), 4326)::geography, '+84000000001', 'ACTIVE',
             true, false, false, 15, 30, 15, 8, 60, 30, 0)
     RETURNING id`,
    [provinceCode, wardCode],
  ];
}

describe('geography (migration 0009, GET /provinces and /wards)', () => {
  let migrator: RoleClient;
  let appRole: RoleClient;

  beforeAll(async () => {
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
  });

  describe('endpoints', () => {
    let testApp: TestApp | undefined;
    let client: TestHttpClient;

    beforeAll(async () => {
      testApp = await createTestApp();
      client = http(testApp.baseUrl);
    });

    afterAll(async () => {
      await testApp?.close();
    });

    it('GET /provinces lists every province without a token, sorted by Vietnamese name', async () => {
      const response = await client.get('/api/v1/provinces');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { code: '94', name: 'An Mẫu', fullName: 'Tỉnh An Mẫu', type: 'PROVINCE' },
        { code: '93', name: 'Đồng Mẫu', fullName: 'Tỉnh Đồng Mẫu', type: 'PROVINCE' },
        { code: '90', name: 'Mẫu Lâm', fullName: 'Thành phố Mẫu Lâm', type: 'CITY' },
      ]);
      expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL);
      expect(response.headers.get('etag')).toMatch(STRONG_ETAG);
    });

    it('GET /wards lists the wards of one province only, sorted by Vietnamese name', async () => {
      const response = await client.get('/api/v1/wards?provinceCode=90');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { code: '90002', name: 'Ánh Mẫu', fullName: 'Đặc khu Ánh Mẫu', type: 'SPECIAL_ZONE' },
        { code: '90001', name: 'Bến Mẫu', fullName: 'Phường Bến Mẫu', type: 'WARD' },
        { code: '90003', name: 'Đông Mẫu', fullName: 'Xã Đông Mẫu', type: 'COMMUNE' },
      ]);
      expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL);
      expect(response.headers.get('etag')).toMatch(STRONG_ETAG);
    });

    it('GET /wards answers an empty list for a known province without wards', async () => {
      const response = await client.get('/api/v1/wards?provinceCode=94');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('GET /wards without provinceCode is VALIDATION_FAILED with REQUIRED', async () => {
      for (const path of ['/api/v1/wards', '/api/v1/wards?provinceCode=']) {
        const response = await client.get(path);

        expect(response.status).toBe(400);
        expect(response.problem).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'provinceCode', code: 'REQUIRED' }],
        });
      }
    });

    it('GET /wards refuses an unknown query parameter', async () => {
      const response = await client.get('/api/v1/wards?provinceCode=90&districtCode=1');

      expect(response.status).toBe(400);
      expect(response.problem?.code).toBe('VALIDATION_FAILED');
    });

    it('GET /wards answers NOT_FOUND for an unknown province, without the code in the body', async () => {
      const response = await client.get('/api/v1/wards?provinceCode=99');

      expect(response.status).toBe(404);
      expect(response.problem?.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('99');
      expect(response.headers.get('cache-control')).not.toBe(CACHE_CONTROL);
    });

    it('answers 304 with no body when If-None-Match carries the current ETag', async () => {
      for (const path of ['/api/v1/provinces', '/api/v1/wards?provinceCode=90']) {
        const first = await client.get(path);
        const etag = first.headers.get('etag') ?? '';

        const second = await client.get(path, { headers: { 'if-none-match': etag } });

        expect(second.status).toBe(304);
        expect(second.body).toBeNull();
        expect(second.headers.get('etag')).toBe(etag);
      }
    });

    it('changes the ETag when a name is updated in place, and answers 200 to the old tag', async () => {
      const before = await client.get('/api/v1/wards?provinceCode=90');
      const oldEtag = before.headers.get('etag') ?? '';

      await migrator.query(
        `UPDATE public.wards SET names = '{"vi": "Bến Mới", "vi_full": "Phường Bến Mới"}'
          WHERE code = '90001'`,
      );
      const after = await client.get('/api/v1/wards?provinceCode=90', {
        headers: { 'if-none-match': oldEtag },
      });

      expect(after.status).toBe(200);
      expect(after.headers.get('etag')).toMatch(STRONG_ETAG);
      expect(after.headers.get('etag')).not.toBe(oldEtag);
      expect(after.body).toContainEqual({
        code: '90001',
        name: 'Bến Mới',
        fullName: 'Phường Bến Mới',
        type: 'WARD',
      });
    });
  });

  describe('constraints', () => {
    it('refuses names without vi', async () => {
      await expectSqlState(
        migrator.query(
          `INSERT INTO public.provinces (code, names, type) VALUES ('95', '{"en": "Sample"}', 'PROVINCE')`,
        ),
        CHECK_VIOLATION,
      );
      await expectSqlState(
        migrator.query(
          `INSERT INTO public.wards (code, province_code, names, type)
           VALUES ('90009', '90', '{"en": "Sample"}', 'WARD')`,
        ),
        CHECK_VIOLATION,
      );
    });

    it('refuses a ward of an unknown province and a duplicate ward code', async () => {
      await expectSqlState(
        migrator.query(
          `INSERT INTO public.wards (code, province_code, names, type)
           VALUES ('99001', '99', '{"vi": "Mẫu"}', 'WARD')`,
        ),
        FOREIGN_KEY_VIOLATION,
      );
      await expectSqlState(
        migrator.query(
          `INSERT INTO public.wards (code, province_code, names, type)
           VALUES ('90001', '93', '{"vi": "Mẫu"}', 'WARD')`,
        ),
        UNIQUE_VIOLATION,
      );
    });

    it('ties a branch to a known province, and its ward to that same province', async () => {
      const [sql, valid] = insertBranchSql('90', '90001');
      expect(await migrator.query(sql, valid)).toHaveLength(1);
      await migrator.query('DELETE FROM public.branches');

      const [, withoutWard] = insertBranchSql('93', null);
      expect(await migrator.query(sql, withoutWard)).toHaveLength(1);
      await migrator.query('DELETE FROM public.branches');

      const [, unknownProvince] = insertBranchSql('99', null);
      await expectSqlState(migrator.query(sql, unknownProvince), FOREIGN_KEY_VIOLATION);

      // 93001 exists, but in province 93: the composite key refuses it for a branch in 90.
      const [, wardOfAnotherProvince] = insertBranchSql('90', '93001');
      await expectSqlState(migrator.query(sql, wardOfAnotherProvince), FOREIGN_KEY_VIOLATION);
    });

    it('refuses to delete a province or a ward that a branch references', async () => {
      const [sql, values] = insertBranchSql('90', '90001');
      await migrator.query(sql, values);

      await expectSqlState(
        migrator.query(`DELETE FROM public.wards WHERE code = '90001'`),
        FOREIGN_KEY_VIOLATION,
      );
      await expectSqlState(
        migrator.query(`DELETE FROM public.provinces WHERE code = '90'`),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  describe('kd_app privileges', () => {
    it('may read both tables', async () => {
      await expect(
        appRole.query('SELECT code FROM public.provinces ORDER BY code'),
      ).resolves.toEqual([{ code: '90' }, { code: '93' }, { code: '94' }]);
      await expect(
        appRole.query(`SELECT count(*)::int AS count FROM public.wards WHERE province_code = '90'`),
      ).resolves.toEqual([{ count: 3 }]);
    });

    it.each(['provinces', 'wards'])('may not write %s', async (table) => {
      const insert =
        table === 'provinces'
          ? `INSERT INTO public.provinces (code, names, type) VALUES ('95', '{"vi": "Mẫu"}', 'PROVINCE')`
          : `INSERT INTO public.wards (code, province_code, names, type) VALUES ('90009', '90', '{"vi": "Mẫu"}', 'WARD')`;

      await appRole.expectPermissionDenied(insert);
      await appRole.expectPermissionDenied(`UPDATE public.${table} SET names = names`);
      await appRole.expectPermissionDenied(`DELETE FROM public.${table}`);
      await appRole.expectPermissionDenied(`TRUNCATE public.${table}`);
    });

    it('has SELECT and nothing else on both tables', async () => {
      const rows = await migrator.query<{ table_name: string; privilege_type: string }>(
        `SELECT table_name::text, privilege_type::text
           FROM information_schema.role_table_grants
          WHERE grantee = 'kd_app' AND table_schema = 'public'
            AND table_name IN ('provinces', 'wards')
          ORDER BY table_name, privilege_type`,
      );

      expect(rows).toEqual([
        { table_name: 'provinces', privilege_type: 'SELECT' },
        { table_name: 'wards', privilege_type: 'SELECT' },
      ]);
    });
  });
});
