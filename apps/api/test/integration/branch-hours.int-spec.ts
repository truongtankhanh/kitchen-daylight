import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A5-T3, `/admin/branches/{id}/hours` and `todayHours` (testing-strategy "Branches, menu and
// search": hours and `rowVersion`): PUT then GET, each validation code over HTTP, STALE_VERSION
// with `current`, nothing written when one item is invalid, past special days surviving a PUT,
// paging and `includePast`, 404 outside a manager's branches, 403 for STAFF, and `todayHours`
// under a fixed `Clock`. As `kd_app` against real PostgreSQL. Fictional data only.

// Wednesday 2026-11-11, 12:00 in Vietnam: today is ISO day 3.
const NOW = '2026-11-11T05:00:00Z';
const TODAY = '2026-11-11';

const ADMIN_ID = '01930000-0000-7000-8000-000000005301';
const MANAGER_A_ID = '01930000-0000-7000-8000-000000005302';
const STAFF_A_ID = '01930000-0000-7000-8000-000000005303';
const SESSION_ID = '01930000-0000-7000-8000-0000000053a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000053b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000053b2';
const UNKNOWN_BRANCH = '01930000-0000-7000-8000-0000000053bf';

const MANAGER_A_NAME = 'Quản lý Giờ Mẫu';

const BRANCHES = '/api/v1/admin/branches';

function hoursPath(branchId: string, search = ''): string {
  return `${BRANCHES}/${branchId}/hours${search}`;
}

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

const INSERT_SPECIAL_SQL = `INSERT INTO public.branch_special_hours
  (branch_id, service, starts_on, ends_on, is_closed, open_time, close_time, closes_next_day, note,
   display_note)
  VALUES ($1, $2::public.branch_service, $3::date, $4::date, true, NULL, NULL, NULL, $5, NULL)`;

interface Period {
  service: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  closesNextDay: boolean;
}

interface SpecialDay {
  startsOn: string;
  endsOn: string;
  service: string;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  closesNextDay: boolean | null;
  note: string | null;
  displayNote: string | null;
}

interface HoursBody {
  rowVersion: number;
  periods: Period[];
  special: { items: SpecialDay[]; page: number; pageSize: number; total: number };
}

interface TodaySession {
  openTime: string;
  closeTime: string;
  closesNextDay: boolean;
}

interface BranchRow {
  id: string;
  todayHours: TodaySession[];
}

/** A valid week for branch A: two shifts on Wednesday, Saturday night into Sunday, delivery. */
const WEEK = [
  { service: 'STORE', dayOfWeek: 3, openTime: '17:00', closeTime: '22:00' },
  { service: 'STORE', dayOfWeek: 3, openTime: '10:00', closeTime: '14:00' },
  { service: 'STORE', dayOfWeek: 6, openTime: '22:00', closeTime: '02:00' },
  { service: 'DELIVERY', dayOfWeek: 3, openTime: '11:00', closeTime: '20:00' },
];

const SPECIAL = [
  {
    startsOn: '2026-11-25',
    endsOn: '2026-11-25',
    service: 'STORE',
    isClosed: false,
    openTime: '09:00',
    closeTime: '12:00',
  },
  {
    startsOn: '2026-11-20',
    endsOn: '2026-11-21',
    service: 'STORE',
    isClosed: true,
    note: '  Bảo trì bếp  ',
    displayNote: 'Nghỉ bảo trì',
  },
];

describe('admin branch hours (kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B] });
    testApp = await createTestApp({ clock: new FixedClock(NOW) });
    client = http(testApp.baseUrl);
    await insertUser(ADMIN_ID, 'ADMIN', 'Quản trị Giờ Mẫu');
    await insertUser(MANAGER_A_ID, 'MANAGER', MANAGER_A_NAME);
    await insertUser(STAFF_A_ID, 'STAFF', 'Nhân viên Giờ Mẫu');
    await query(
      'INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2), ($3, $2)',
      [MANAGER_A_ID, BRANCH_A, STAFF_A_ID],
    );
  });

  afterEach(async () => {
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(id: string, role: UserRole, displayName: string): Promise<unknown> {
    return query(INSERT_USER_SQL, [
      id,
      `fixture-hours-${id.slice(-4)}@kd.example`,
      displayName,
      role,
    ]);
  }

  function insertClosedDay(startsOn: string, endsOn: string, note: string): Promise<unknown> {
    return query(INSERT_SPECIAL_SQL, [BRANCH_A, 'STORE', startsOn, endsOn, note]);
  }

  async function headersOf(userId: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  function asAdmin(): Promise<Record<string, string>> {
    return headersOf(ADMIN_ID, 'ADMIN');
  }

  function asManagerA(): Promise<Record<string, string>> {
    return headersOf(MANAGER_A_ID, 'MANAGER');
  }

  async function getHours(
    branchId: string,
    search = '',
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.get(hoursPath(branchId, search), { headers: headers ?? (await asManagerA()) });
  }

  async function readHours(branchId: string, search = ''): Promise<HoursBody> {
    const response = await getHours(branchId, search);
    expect(response.status).toBe(200);
    return response.body as HoursBody;
  }

  async function putHours(
    branchId: string,
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return client.request(hoursPath(branchId), {
      method: 'PUT',
      body,
      headers: headers ?? (await asManagerA()),
    });
  }

  function fieldErrorsOf(response: TestResponse): { field: string; code: string }[] {
    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
    return (response.problem?.errors ?? []).map(({ field, code }) => ({ field, code }));
  }

  async function storedSpecialEnds(): Promise<string[]> {
    const rows = await query<{ ends_on: string }>(
      `SELECT to_char(ends_on, 'YYYY-MM-DD') AS ends_on FROM public.branch_special_hours
        WHERE branch_id = $1 ORDER BY ends_on`,
      [BRANCH_A],
    );
    return rows.map((row) => row.ends_on);
  }

  async function branchState(): Promise<{
    row_version: number;
    updated_by: string | null;
    updated_at: Date;
  }> {
    const rows = await query<{ row_version: number; updated_by: string | null; updated_at: Date }>(
      `SELECT row_version, updated_by::text AS updated_by, updated_at
         FROM public.branches WHERE id = $1`,
      [BRANCH_A],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture branch A is missing');
    }
    return row;
  }

  async function todayHoursOf(headers: Record<string, string>): Promise<Map<string, unknown>> {
    const response = await client.get(BRANCHES, { headers });
    expect(response.status).toBe(200);
    const items = (response.body as { items: BranchRow[] }).items;
    return new Map(items.map((item) => [item.id, item.todayHours]));
  }

  // -------------------------------------------------------------------------------------------
  // Roles and scoping
  // -------------------------------------------------------------------------------------------

  describe('roles and scoping', () => {
    it('answers 401 without a token', async () => {
      const response = await client.get(hoursPath(BRANCH_A));

      expect(response.status).toBe(401);
      expect(response.problem?.code).toBe('UNAUTHENTICATED');
    });

    it('answers 403 FORBIDDEN to STAFF on GET and PUT, their own branch included', async () => {
      const headers = await headersOf(STAFF_A_ID, 'STAFF');
      const responses = [
        await getHours(BRANCH_A, '', headers),
        await putHours(BRANCH_A, { rowVersion: 1, periods: [], special: [] }, headers),
      ];

      expect(responses.map((response) => [response.status, response.problem?.code])).toEqual([
        [403, 'FORBIDDEN'],
        [403, 'FORBIDDEN'],
      ]);
      expect((await branchState()).row_version).toBe(1);
    });

    it('answers 404 to a manager on a branch outside their list, and for an unknown branch', async () => {
      const responses = [
        await getHours(BRANCH_B),
        await putHours(BRANCH_B, { rowVersion: 1, periods: WEEK, special: [] }),
        await getHours(UNKNOWN_BRANCH, '', await asAdmin()),
        await putHours(
          UNKNOWN_BRANCH,
          { rowVersion: 1, periods: [], special: [] },
          await asAdmin(),
        ),
      ];

      expect(responses.map((response) => [response.status, response.problem?.code])).toEqual(
        Array.from({ length: 4 }, () => [404, 'NOT_FOUND']),
      );
      const rows = await query('SELECT 1 FROM public.branch_opening_periods');
      expect(rows).toEqual([]);
    });

    it('lets an ADMIN read and write any branch', async () => {
      const response = await putHours(
        BRANCH_B,
        { rowVersion: 1, periods: WEEK, special: [] },
        await asAdmin(),
      );

      expect(response.status).toBe(200);
      expect((response.body as HoursBody).periods).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------------------------
  // PUT and GET
  // -------------------------------------------------------------------------------------------

  describe('PUT then GET', () => {
    it('stores the week and the special days, derives closesNextDay and returns the GET body', async () => {
      const response = await putHours(BRANCH_A, { rowVersion: 1, periods: WEEK, special: SPECIAL });

      expect(response.status).toBe(200);
      const expected: HoursBody = {
        rowVersion: 2,
        periods: [
          {
            service: 'STORE',
            dayOfWeek: 3,
            openTime: '10:00',
            closeTime: '14:00',
            closesNextDay: false,
          },
          {
            service: 'STORE',
            dayOfWeek: 3,
            openTime: '17:00',
            closeTime: '22:00',
            closesNextDay: false,
          },
          {
            service: 'STORE',
            dayOfWeek: 6,
            openTime: '22:00',
            closeTime: '02:00',
            closesNextDay: true,
          },
          {
            service: 'DELIVERY',
            dayOfWeek: 3,
            openTime: '11:00',
            closeTime: '20:00',
            closesNextDay: false,
          },
        ],
        special: {
          items: [
            {
              startsOn: '2026-11-20',
              endsOn: '2026-11-21',
              service: 'STORE',
              isClosed: true,
              openTime: null,
              closeTime: null,
              closesNextDay: null,
              note: 'Bảo trì bếp',
              displayNote: 'Nghỉ bảo trì',
            },
            {
              startsOn: '2026-11-25',
              endsOn: '2026-11-25',
              service: 'STORE',
              isClosed: false,
              openTime: '09:00',
              closeTime: '12:00',
              closesNextDay: false,
              note: null,
              displayNote: null,
            },
          ],
          page: 1,
          pageSize: 20,
          total: 2,
        },
      };
      expect(response.body).toEqual(expected);
      expect(await readHours(BRANCH_A)).toEqual(expected);
      const branch = await branchState();
      expect({ rowVersion: branch.row_version, updatedBy: branch.updated_by }).toEqual({
        rowVersion: 2,
        updatedBy: MANAGER_A_ID,
      });
    });

    it('replaces the weekly list completely', async () => {
      await putHours(BRANCH_A, { rowVersion: 1, periods: WEEK, special: SPECIAL });

      const response = await putHours(BRANCH_A, {
        rowVersion: 2,
        periods: [{ service: 'STORE', dayOfWeek: 1, openTime: '08:00', closeTime: '12:00' }],
        special: [],
      });

      expect(response.status).toBe(200);
      const body = response.body as HoursBody;
      expect(body.periods.map((period) => [period.dayOfWeek, period.openTime])).toEqual([
        [1, '08:00'],
      ]);
      expect(body.special.total).toBe(0);
      expect(body.rowVersion).toBe(3);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------------------------

  describe('validation', () => {
    it('reports every item code with its path', async () => {
      const response = await putHours(BRANCH_A, {
        rowVersion: 1,
        periods: [
          { service: 'STORE', dayOfWeek: 3, openTime: '25:00', closeTime: '12:00' },
          { service: 'STORE', dayOfWeek: 3, openTime: '10:00', closeTime: '10:00' },
          { service: 'STORE', dayOfWeek: 4, openTime: '10:00', closeTime: '14:00' },
          { service: 'STORE', dayOfWeek: 4, openTime: '12:00', closeTime: '16:00' },
          { service: 'STORE', dayOfWeek: 5, openTime: '10:00' },
          {
            service: 'STORE',
            dayOfWeek: 6,
            openTime: '22:00',
            closeTime: '02:00',
            closesNextDay: true,
          },
        ],
        special: [
          { startsOn: '2026-11-20', endsOn: '2026-11-18', service: 'STORE', isClosed: true },
          {
            startsOn: '2026-11-22',
            endsOn: '2026-11-22',
            service: 'STORE',
            isClosed: true,
            openTime: '10:00',
          },
          {
            startsOn: '2026-11-23',
            endsOn: '2026-11-23',
            service: 'STORE',
            isClosed: false,
            openTime: '10:00',
            closeTime: '12:00',
            displayNote: 'd'.repeat(81),
          },
          {
            startsOn: '2026-11-24',
            endsOn: '2026-11-24',
            service: 'STORE',
            isClosed: true,
            note: 'n'.repeat(201),
          },
          { startsOn: '2026-12-01', endsOn: '2026-12-03', service: 'STORE', isClosed: true },
          { startsOn: '2026-12-03', endsOn: '2026-12-04', service: 'STORE', isClosed: true },
          { startsOn: '2026-11-01', endsOn: '2026-11-02', service: 'STORE', isClosed: true },
        ],
      });

      expect(fieldErrorsOf(response)).toEqual([
        { field: 'periods[0].openTime', code: 'INVALID_TIME' },
        { field: 'periods[1].closeTime', code: 'EQUAL_TIMES' },
        { field: 'periods[4].closeTime', code: 'REQUIRED' },
        { field: 'periods[5].closesNextDay', code: 'INVALID' },
        { field: 'special[0].endsOn', code: 'RANGE_INVALID' },
        { field: 'special[1].openTime', code: 'INVALID' },
        { field: 'special[2].displayNote', code: 'TOO_LONG' },
        { field: 'special[3].note', code: 'TOO_LONG' },
        { field: 'special[6].endsOn', code: 'OUT_OF_RANGE' },
        { field: 'periods[3].openTime', code: 'OVERLAP' },
        { field: 'special[5].startsOn', code: 'OVERLAP' },
      ]);
    });

    it('refuses an overlap across midnight, Sunday into Monday', async () => {
      const response = await putHours(BRANCH_A, {
        rowVersion: 1,
        periods: [
          { service: 'STORE', dayOfWeek: 7, openTime: '22:00', closeTime: '03:00' },
          { service: 'STORE', dayOfWeek: 1, openTime: '02:00', closeTime: '06:00' },
        ],
        special: [],
      });

      expect(fieldErrorsOf(response)).toEqual([{ field: 'periods[1].openTime', code: 'OVERLAP' }]);
    });

    it('requires rowVersion, periods and special', async () => {
      expect(fieldErrorsOf(await putHours(BRANCH_A, {}))).toEqual([
        { field: 'rowVersion', code: 'REQUIRED' },
        { field: 'periods', code: 'REQUIRED' },
        { field: 'special', code: 'REQUIRED' },
      ]);
    });

    it('writes nothing when one item is invalid', async () => {
      await putHours(BRANCH_A, { rowVersion: 1, periods: WEEK, special: SPECIAL });
      const before = await readHours(BRANCH_A);

      const response = await putHours(BRANCH_A, {
        rowVersion: 2,
        periods: [
          { service: 'STORE', dayOfWeek: 1, openTime: '08:00', closeTime: '12:00' },
          { service: 'STORE', dayOfWeek: 2, openTime: '08:00', closeTime: '8:00' },
        ],
        special: [],
      });

      expect(fieldErrorsOf(response)).toEqual([
        { field: 'periods[1].closeTime', code: 'INVALID_TIME' },
      ]);
      expect(await readHours(BRANCH_A)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Concurrency
  // -------------------------------------------------------------------------------------------

  describe('rowVersion', () => {
    it('answers STALE_VERSION with who changed the branch and when, and writes nothing', async () => {
      await putHours(BRANCH_A, { rowVersion: 1, periods: WEEK, special: [] });
      const changed = await branchState();

      const response = await putHours(
        BRANCH_A,
        { rowVersion: 1, periods: [], special: [] },
        await asAdmin(),
      );

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('STALE_VERSION');
      expect((response.body as { current: unknown }).current).toEqual({
        rowVersion: 2,
        updatedBy: { id: MANAGER_A_ID, name: MANAGER_A_NAME },
        updatedAt: changed.updated_at.toISOString(),
      });
      expect((await readHours(BRANCH_A)).periods).toHaveLength(4);
    });

    it('makes an open branch editor stale, since the branch rowVersion moved', async () => {
      await putHours(BRANCH_A, { rowVersion: 1, periods: WEEK, special: [] });

      const response = await client.request(`${BRANCHES}/${BRANCH_A}`, {
        method: 'PATCH',
        body: { rowVersion: 1, name: 'Đổi tên' },
        headers: await asManagerA(),
      });

      expect(response.status).toBe(409);
      expect(response.problem?.code).toBe('STALE_VERSION');
    });
  });

  // -------------------------------------------------------------------------------------------
  // Special days: history, paging, includePast (brief C17)
  // -------------------------------------------------------------------------------------------

  describe('special days', () => {
    it('keeps the days that ended before today and replaces those ending today or later', async () => {
      await insertClosedDay('2026-11-01', '2026-11-05', 'Đã qua');
      await insertClosedDay('2026-11-10', '2026-11-10', 'Hôm qua');
      await insertClosedDay(TODAY, TODAY, 'Hôm nay');
      await insertClosedDay('2026-11-30', '2026-12-01', 'Sắp tới');

      const response = await putHours(BRANCH_A, {
        rowVersion: 1,
        periods: [],
        special: [
          { startsOn: '2026-12-10', endsOn: '2026-12-10', service: 'STORE', isClosed: true },
        ],
      });

      expect(response.status).toBe(200);
      expect(await storedSpecialEnds()).toEqual(['2026-11-05', '2026-11-10', '2026-12-10']);
    });

    it('refuses a range that overlaps a kept past day, and writes nothing', async () => {
      await insertClosedDay('2026-11-08', '2026-11-10', 'Hôm qua');

      const response = await putHours(BRANCH_A, {
        rowVersion: 1,
        periods: WEEK,
        special: [{ startsOn: '2026-11-10', endsOn: TODAY, service: 'STORE', isClosed: true }],
      });

      expect(fieldErrorsOf(response)).toEqual([{ field: 'special[0].startsOn', code: 'OVERLAP' }]);
      expect(await storedSpecialEnds()).toEqual(['2026-11-10']);
      expect((await readHours(BRANCH_A)).periods).toEqual([]);
      expect((await branchState()).row_version).toBe(1);
    });

    it('pages the days from today on, and adds the last 30 days with includePast=true', async () => {
      await insertClosedDay('2026-10-01', '2026-10-01', 'Quá 30 ngày');
      await insertClosedDay('2026-10-22', '2026-10-22', 'Trong 30 ngày');
      await insertClosedDay('2026-11-10', '2026-11-10', 'Hôm qua');
      await insertClosedDay('2026-11-05', TODAY, 'Đang diễn ra');
      await insertClosedDay('2026-11-20', '2026-11-20', 'Sắp tới 1');
      await insertClosedDay('2026-11-25', '2026-11-26', 'Sắp tới 2');

      const notes = (body: HoursBody): (string | null)[] =>
        body.special.items.map((item) => item.note);

      const current = await readHours(BRANCH_A);
      expect(notes(current)).toEqual(['Đang diễn ra', 'Sắp tới 1', 'Sắp tới 2']);
      expect(current.special.total).toBe(3);

      const secondPage = await readHours(BRANCH_A, '?page=2&pageSize=2');
      expect(notes(secondPage)).toEqual(['Sắp tới 2']);
      expect(secondPage.special).toMatchObject({ page: 2, pageSize: 2, total: 3 });

      const withPast = await readHours(BRANCH_A, '?includePast=true');
      expect(notes(withPast)).toEqual([
        'Trong 30 ngày',
        'Đang diễn ra',
        'Hôm qua',
        'Sắp tới 1',
        'Sắp tới 2',
      ]);
      expect(withPast.special.total).toBe(5);

      expect(notes(await readHours(BRANCH_A, '?includePast=false'))).toHaveLength(3);
      expect(fieldErrorsOf(await getHours(BRANCH_A, '?includePast=yes'))).toEqual([
        { field: 'includePast', code: 'INVALID' },
      ]);
    });
  });

  // -------------------------------------------------------------------------------------------
  // todayHours of AdminBranchRow (fixed Clock: Wednesday 2026-11-11)
  // -------------------------------------------------------------------------------------------

  describe('todayHours', () => {
    it('lists today’s store sessions, without yesterday’s night session or delivery', async () => {
      await putHours(BRANCH_A, {
        rowVersion: 1,
        periods: [
          ...WEEK,
          { service: 'STORE', dayOfWeek: 2, openTime: '23:00', closeTime: '01:00' },
          { service: 'STORE', dayOfWeek: 3, openTime: '23:00', closeTime: '01:00' },
        ],
        special: [],
      });

      const today = await todayHoursOf(await asAdmin());

      expect(today.get(BRANCH_A)).toEqual([
        { openTime: '10:00', closeTime: '14:00', closesNextDay: false },
        { openTime: '17:00', closeTime: '22:00', closesNextDay: false },
        { openTime: '23:00', closeTime: '01:00', closesNextDay: true },
      ]);
      expect(today.get(BRANCH_B)).toEqual([]);
    });

    it('applies a special day of today, in the list and the detail', async () => {
      await putHours(BRANCH_A, {
        rowVersion: 1,
        periods: WEEK,
        special: [
          {
            startsOn: '2026-11-10',
            endsOn: '2026-11-12',
            service: 'STORE',
            isClosed: false,
            openTime: '09:00',
            closeTime: '12:00',
          },
        ],
      });

      expect((await todayHoursOf(await asManagerA())).get(BRANCH_A)).toEqual([
        { openTime: '09:00', closeTime: '12:00', closesNextDay: false },
      ]);
      const detail = await client.get(`${BRANCHES}/${BRANCH_A}`, { headers: await asAdmin() });
      expect((detail.body as BranchRow).todayHours).toEqual([
        { openTime: '09:00', closeTime: '12:00', closesNextDay: false },
      ]);
    });

    it('is an empty list on a closed special day', async () => {
      await putHours(BRANCH_A, {
        rowVersion: 1,
        periods: WEEK,
        special: [{ startsOn: TODAY, endsOn: TODAY, service: 'STORE', isClosed: true }],
      });

      expect((await todayHoursOf(await asAdmin())).get(BRANCH_A)).toEqual([]);
    });
  });
});
