import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { openRoleClient } from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A5-T5, `GET /admin/wards` (brief C7): the staff ward search of the branch editor. Accent and
// case insensitive through `kd_unaccent`, `%` and `_` literal, prefix matches first, the `limit`
// cap of 20, repeated `ids` (the bracket key `ids[]` is refused, D-146), an unknown province, and
// the role checks. The reference rows are
// written here by SQL as kd_migrator (apps/api may not import tools/seed, decision 0003). Province
// codes 90 and 93 do not exist; the names are made up in the style of real ones.

const STAFF_ID = '01930000-0000-7000-8000-000000005601';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000005602';
const SESSION_ID = '01930000-0000-7000-8000-0000000056a1';

const WARDS = '/api/v1/admin/wards';

const INSERT_PROVINCES_SQL = `INSERT INTO public.provinces (code, names, type) VALUES
  ('90', '{"vi": "Mẫu Lâm", "vi_full": "Thành phố Mẫu Lâm"}', 'CITY'),
  ('93', '{"vi": "Đồng Mẫu", "vi_full": "Tỉnh Đồng Mẫu"}', 'PROVINCE')`;

// `An Ba Đình` sorts before `Ba Đình` by name, so it shows the prefix rule; `Bà Điểm` shares the
// first word only; the two `Khu` rows tell a literal `%` or `_` from a wildcard.
const INSERT_WARDS_SQL = `INSERT INTO public.wards (code, province_code, names, type) VALUES
  ('90001', '90', '{"vi": "Ba Đình", "vi_full": "Phường Ba Đình"}', 'WARD'),
  ('90002', '90', '{"vi": "An Ba Đình", "vi_full": "Xã An Ba Đình"}', 'COMMUNE'),
  ('90003', '90', '{"vi": "Bà Điểm", "vi_full": "Xã Bà Điểm"}', 'COMMUNE'),
  ('90004', '90', '{"vi": "Khu 5% Mẫu", "vi_full": "Phường Khu 5% Mẫu"}', 'WARD'),
  ('90005', '90', '{"vi": "Khu 50 Mẫu", "vi_full": "Phường Khu 50 Mẫu"}', 'WARD'),
  ('90006', '90', '{"vi": "Đảo Mẫu", "vi_full": "Đặc khu Đảo Mẫu"}', 'SPECIAL_ZONE')`;

/** 25 wards in province 93, `Mẫu 01` to `Mẫu 25`, codes 93001 to 93025. */
const INSERT_MANY_WARDS_SQL = `INSERT INTO public.wards (code, province_code, names, type)
SELECT (93000 + n)::text, '93',
       jsonb_build_object('vi', 'Mẫu ' || lpad(n::text, 2, '0'),
                          'vi_full', 'Phường Mẫu ' || lpad(n::text, 2, '0')),
       'WARD'
  FROM generate_series(1, 25) AS n`;

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

interface WardItem {
  code: string;
  provinceCode: string;
  name: string;
  type: string;
}

function codesOf(response: TestResponse): string[] {
  return (response.body as { items: WardItem[] }).items.map((item) => item.code);
}

describe('GET /admin/wards (kd_app, real PostgreSQL)', () => {
  let migrator: RoleClient;
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeAll(async () => {
    migrator = await openRoleClient('kd_migrator');
    testApp = await createTestApp();
    client = http(testApp.baseUrl);
  });

  afterAll(async () => {
    await testApp.close();
    await migrator.close();
  });

  beforeEach(async () => {
    await truncateAll();
    await migrator.query(INSERT_PROVINCES_SQL);
    await migrator.query(INSERT_WARDS_SQL);
    await migrator.query(INSERT_MANY_WARDS_SQL);
    for (const [id, role] of [
      [STAFF_ID, 'STAFF'],
      [CUSTOMER_ID, 'CUSTOMER'],
    ] as const) {
      await testApp.dataSource.query(INSERT_USER_SQL, [
        id,
        `fixture-wards-${id.slice(-4)}@kd.example`,
        'Người dùng Mẫu',
        role,
      ]);
    }
  });

  async function headersOf(userId: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  /** `GET /admin/wards` as the staff member; `params` keep their order and repeated keys. */
  async function search(
    params: readonly (readonly [string, string])[],
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    const query = new URLSearchParams(params.map(([key, value]) => [key, value])).toString();
    return client.get(`${WARDS}?${query}`, {
      headers: headers ?? (await headersOf(STAFF_ID, 'STAFF')),
    });
  }

  it('finds "Ba Đình" from "ba dinh", prefix matches before other matches', async () => {
    const response = await search([
      ['provinceCode', '90'],
      ['q', 'ba dinh'],
    ]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [
        { code: '90001', provinceCode: '90', name: 'Ba Đình', type: 'WARD' },
        { code: '90002', provinceCode: '90', name: 'An Ba Đình', type: 'COMMUNE' },
      ],
    });
  });

  it.each(['BA DINH', 'BA ĐÌNH', 'Ba Đình', '  ba đình  '])(
    'matches %j the same way',
    async (q) => {
      const response = await search([
        ['provinceCode', '90'],
        ['q', q],
      ]);

      expect(response.status).toBe(200);
      expect(codesOf(response)).toEqual(['90001', '90002']);
    },
  );

  it('reads % in q as a literal character', async () => {
    const response = await search([
      ['provinceCode', '90'],
      ['q', '5%'],
    ]);

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['90004']);
  });

  it('reads _ in q as a literal character', async () => {
    const response = await search([
      ['provinceCode', '90'],
      ['q', 'khu _0'],
    ]);

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual([]);
  });

  it('lists the province by name without q', async () => {
    const response = await search([['provinceCode', '90']]);

    expect(response.status).toBe(200);
    // Vietnamese collator: `ê` is a letter before `n` (`Bà Điểm` before `Ba Đình`), `Đ` after `D`.
    expect(codesOf(response)).toEqual(['90002', '90003', '90001', '90006', '90004', '90005']);
  });

  it('returns 20 rows by default and with limit=20, and at most limit rows', async () => {
    const byDefault = await search([['provinceCode', '93']]);
    const twenty = await search([
      ['provinceCode', '93'],
      ['limit', '20'],
    ]);
    const five = await search([
      ['provinceCode', '93'],
      ['limit', '5'],
    ]);

    expect(byDefault.status).toBe(200);
    expect(codesOf(byDefault)).toHaveLength(20);
    expect(codesOf(byDefault)[0]).toBe('93001');
    expect(codesOf(twenty)).toEqual(codesOf(byDefault));
    expect(codesOf(five)).toEqual(['93001', '93002', '93003', '93004', '93005']);
  });

  it.each(['21', '0', 'abc'])('refuses limit=%s with 400 VALIDATION_FAILED', async (limit) => {
    const response = await search([
      ['provinceCode', '93'],
      ['limit', limit],
    ]);

    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
  });

  it('rebuilds chips from repeated ids, leaving out unknown codes and other provinces', async () => {
    const response = await search([
      ['provinceCode', '90'],
      ['ids', '90005'],
      ['ids', '90001'],
      ['ids', '99999'],
      ['ids', '93001'],
    ]);

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['90001', '90005']);
  });

  it('accepts a single ids value', async () => {
    const response = await search([
      ['provinceCode', '90'],
      ['ids', '90003'],
    ]);

    expect(response.status).toBe(200);
    expect(codesOf(response)).toEqual(['90003']);
  });

  it('refuses the bracket key ids[] as an unknown parameter (D-146)', async () => {
    const response = await search([
      ['provinceCode', '90'],
      ['ids[]', '90001'],
    ]);

    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
  });

  it('refuses more than 20 ids', async () => {
    const ids = Array.from({ length: 21 }, (_, index) => ['ids', String(93001 + index)] as const);

    const response = await search([['provinceCode', '93'], ...ids]);

    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
  });

  it('answers an empty list for a province code that does not exist', async () => {
    const response = await search([
      ['provinceCode', '99'],
      ['q', 'ba'],
    ]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('requires provinceCode', async () => {
    const response = await search([['q', 'ba']]);

    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
  });

  it('answers 401 without a token and 403 to a customer', async () => {
    const anonymous = await client.get(`${WARDS}?provinceCode=90`);
    expect(anonymous.status).toBe(401);

    const customer = await search(
      [['provinceCode', '90']],
      await headersOf(CUSTOMER_ID, 'CUSTOMER'),
    );
    expect(customer.status).toBe(403);
  });
});
