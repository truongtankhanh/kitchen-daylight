import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { KeySet } from '../../src/modules/auth/key-set.js';
import { SecretCipher } from '../../src/modules/auth/mfa/secret-cipher.js';
import { signStepUpToken } from '../../src/modules/auth/step-up/step-up.service.js';
import { MailService } from '../../src/modules/mail/mail.service.js';
import type { MailMessage } from '../../src/modules/mail/ports/mail.port.js';
import type { SettingValues } from '../../src/modules/settings/schema/registry.js';
import { SETTING_KEYS } from '../../src/modules/settings/schema/setting-rules.js';
import type { SettingKey } from '../../src/modules/settings/schema/setting-rules.js';
import { SETTING_DEFAULTS } from '../../src/modules/settings/settings-defaults.js';
import type { UserRole, UserStatus } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A4-T2: `GET, PUT /admin/app-settings` and `GET /admin/meta/config` end to end, as `kd_app`,
// against real PostgreSQL (testing-strategy "rowVersion" bullet; brief L1, L2, L10, L14, Z1 to Z4).
// `MailService.send` records instead of sending. Fictional data only; the bank details are
// placeholders.

const NOW = '2026-11-08T03:00:00.000Z';

const SETTINGS_PATH = '/api/v1/admin/app-settings';
const META_PATH = '/api/v1/admin/meta/config';

const ADMIN_ID = '01930000-0000-7000-8000-000000002401';
const OTHER_ADMIN_ID = '01930000-0000-7000-8000-000000002402';
const SUSPENDED_ADMIN_ID = '01930000-0000-7000-8000-000000002403';
const MANAGER_ID = '01930000-0000-7000-8000-000000002404';
const STAFF_ID = '01930000-0000-7000-8000-000000002405';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000002406';
const SESSION_ID = '01930000-0000-7000-8000-0000000024a1';

const BRANCH_A = '01930000-0000-7000-8000-0000000024b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000024b2';
const BRANCH_DELETED = '01930000-0000-7000-8000-0000000024b3';

const OTHER_ADMIN_EMAIL = 'fixture-settings-other@kd.example';

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, $5)`;

const ACCOUNT_NUMBER = '0000000012345';

/** Fictional bank details. */
const PAYMENT: SettingValues['payment'] = {
  bankName: 'Ngân hàng Mẫu',
  accountNumber: ACCOUNT_NUMBER,
  accountHolder: 'CONG TY MAU',
  transferNoteRule: 'Mã đơn hàng',
  bankCode: '000001',
  qrMediaId: null,
};

/** A changed value per key, valid under the rules of A4-T1. */
const CHANGED: { readonly [Key in SettingKey]: SettingValues[Key] } = {
  brand: { ...SETTING_DEFAULTS.brand, name: 'Kitchen Daylight Mẫu', hotline: '+842800000001' },
  reports: { businessDayStartsAt: '05:00' },
  minAppVersion: { ios: '1.2.0', android: '1.2.1' },
  maintenance: {
    enabled: true,
    message: 'Hệ thống đang bảo trì.',
    expectedBackAt: '2026-11-08T05:00:00.000Z',
    since: '2026-11-08T03:00:00.000Z',
  },
  featureFlags: { ...SETTING_DEFAULTS.featureFlags, loyalty: true },
  payment: PAYMENT,
  ordering: { ...SETTING_DEFAULTS.ordering, maxCartLines: 25 },
  loyalty: {
    earnVndPerPoint: 10_000,
    redeemVndPerPoint: 1_000,
    minRedeemPoints: 10,
    expiryMonths: 12,
  },
};

interface RecordBody {
  value: unknown;
  rowVersion: number;
  updatedBy: { id: string; name: string } | null;
  updatedAt: string | null;
}

interface AuditRow {
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  branch_id: string | null;
  diff: Record<string, unknown>;
}

describe('admin settings and meta config (kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;
  let sent: MailMessage[];

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B, BRANCH_DELETED] });
    clock = new FixedClock(NOW);
    testApp = await createTestApp({ clock });
    client = http(testApp.baseUrl);
    sent = [];
    vi.spyOn(testApp.app.get(MailService), 'send').mockImplementation((message) => {
      sent.push(message);
      return Promise.resolve(undefined);
    });

    await query('UPDATE public.branches SET deleted_at = now() WHERE id = $1', [BRANCH_DELETED]);
    await insertUser(ADMIN_ID, 'fixture-settings-admin@kd.example', 'Quản trị Mẫu', 'ADMIN');
    await insertUser(OTHER_ADMIN_ID, OTHER_ADMIN_EMAIL, 'Quản trị Khác', 'ADMIN');
    await insertUser(
      SUSPENDED_ADMIN_ID,
      'fixture-settings-suspended@kd.example',
      'Quản trị Tạm khóa',
      'ADMIN',
      'SUSPENDED',
    );
    await insertUser(MANAGER_ID, 'fixture-settings-manager@kd.example', 'Quản lý Mẫu', 'MANAGER');
    await insertUser(STAFF_ID, 'fixture-settings-staff@kd.example', 'Nhân viên Mẫu', 'STAFF');
    await insertUser(CUSTOMER_ID, 'fixture-settings-customer@kd.example', 'Khách Mẫu', 'CUSTOMER');
    await query(
      'INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2), ($3, $4)',
      [MANAGER_ID, BRANCH_A, STAFF_ID, BRANCH_B],
    );
    await query(
      `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, enabled_at)
       VALUES ($1, $2, '2026-10-01T00:00:00Z')`,
      [ADMIN_ID, testApp.app.get(SecretCipher).encrypt(randomBytes(20), ADMIN_ID)],
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  function insertUser(
    id: string,
    email: string,
    name: string,
    role: UserRole,
    status: UserStatus = 'ACTIVE',
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, name, role, status]);
  }

  async function bearer(id: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId: id, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  async function stepUpToken(id = ADMIN_ID): Promise<string> {
    const grant = await signStepUpToken(
      testApp.app.get(KeySet),
      clock.now(),
      id,
      'settings.payment',
    );
    return grant.stepUpToken;
  }

  async function readSettings(id = ADMIN_ID, role: UserRole = 'ADMIN'): Promise<TestResponse> {
    return client.get(SETTINGS_PATH, { headers: await bearer(id, role) });
  }

  async function save(
    body: unknown,
    options: { id?: string; role?: UserRole; stepUp?: string } = {},
  ): Promise<TestResponse> {
    const headers = await bearer(options.id ?? ADMIN_ID, options.role ?? 'ADMIN');
    return client.request(SETTINGS_PATH, {
      method: 'PUT',
      body,
      headers:
        options.stepUp === undefined ? headers : { ...headers, 'X-Step-Up-Token': options.stepUp },
    });
  }

  /** Saves `value` as the admin, with a step-up token when the key needs one. */
  async function saveAs(
    key: SettingKey,
    value: unknown,
    rowVersion: number,
    id = ADMIN_ID,
  ): Promise<TestResponse> {
    return save(
      { key, value, rowVersion },
      { id, stepUp: key === 'payment' ? await stepUpToken(id) : undefined },
    );
  }

  async function meta(id: string, role: UserRole): Promise<TestResponse> {
    return client.get(META_PATH, { headers: await bearer(id, role) });
  }

  function auditRows(): Promise<AuditRow[]> {
    return query(
      `SELECT actor_user_id::text AS actor_user_id, entity_type::text AS entity_type, entity_id,
              entity_label, branch_id::text AS branch_id, diff
         FROM public.audit_logs WHERE action = 'settings.change' ORDER BY created_at, id`,
    );
  }

  function expectProblem(response: TestResponse, status: number, code: string): void {
    expect({ status: response.status, code: response.problem?.code }).toEqual({ status, code });
  }

  describe('access', () => {
    it.each([
      ['MANAGER', MANAGER_ID],
      ['STAFF', STAFF_ID],
    ] as const)('refuses %s on GET and PUT with FORBIDDEN', async (role, id) => {
      expectProblem(await readSettings(id, role), 403, 'FORBIDDEN');
      expectProblem(
        await save({ key: 'reports', value: CHANGED.reports, rowVersion: 0 }, { id, role }),
        403,
        'FORBIDDEN',
      );
      expect(await auditRows()).toEqual([]);
    });

    it('refuses a customer on meta/config and an anonymous caller everywhere', async () => {
      expectProblem(await meta(CUSTOMER_ID, 'CUSTOMER'), 403, 'FORBIDDEN');
      expectProblem(await client.get(SETTINGS_PATH), 401, 'UNAUTHENTICATED');
      expectProblem(await client.get(META_PATH), 401, 'UNAUTHENTICATED');
    });
  });

  describe('GET /admin/app-settings', () => {
    it('returns every key as its default with rowVersion 0, plus the read-only security block', async () => {
      const response = await readSettings();

      expect(response.status).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([...SETTING_KEYS, 'security'].sort());
      for (const key of SETTING_KEYS) {
        expect(body[key]).toEqual({
          value: SETTING_DEFAULTS[key],
          rowVersion: 0,
          updatedBy: null,
          updatedAt: null,
        });
      }
      expect(body['security']).toEqual({
        totpRequiredRoles: ['MANAGER', 'ADMIN'],
        staffPasswordMinLength: 12,
        accessTokenMinutes: 15,
        sessionIdleDays: 1,
        sessionAbsoluteDays: 7,
        inviteHours: 48,
        resetMinutes: 30,
      });
    });
  });

  describe('PUT /admin/app-settings', () => {
    it.each(SETTING_KEYS)('round-trips %s and moves its rowVersion only', async (key) => {
      const first = await saveAs(key, CHANGED[key], 0);

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        key,
        value: CHANGED[key],
        rowVersion: 1,
        updatedBy: { id: ADMIN_ID, name: 'Quản trị Mẫu' },
      });
      const second = await saveAs(key, SETTING_DEFAULTS[key], 1);
      expect(second.status).toBe(200);
      expect((second.body as RecordBody).rowVersion).toBe(2);

      const all = (await readSettings()).body as Record<string, RecordBody>;
      expect(all[key]).toMatchObject({ value: SETTING_DEFAULTS[key], rowVersion: 2 });
      for (const other of SETTING_KEYS.filter((name) => name !== key)) {
        expect(all[other]?.rowVersion).toBe(0);
      }
    });

    it('sets maintenance.since itself and ignores the value sent (D-127)', async () => {
      const on = await saveAs(
        'maintenance',
        { ...CHANGED.maintenance, since: '2020-01-01T00:00:00.000Z' },
        0,
      );
      expect(on.status).toBe(200);
      expect((on.body as RecordBody).value).toMatchObject({ enabled: true, since: NOW });

      clock.advance(60_000);
      const kept = await saveAs(
        'maintenance',
        { ...CHANGED.maintenance, message: 'Vẫn đang bảo trì.', since: null },
        1,
      );
      expect(kept.status).toBe(200);
      expect((kept.body as RecordBody).value).toMatchObject({ enabled: true, since: NOW });

      const off = await saveAs(
        'maintenance',
        { ...SETTING_DEFAULTS.maintenance, since: '2026-11-08T03:00:00.000Z' },
        2,
      );
      expect(off.status).toBe(200);
      expect((off.body as RecordBody).value).toMatchObject({ enabled: false, since: null });

      clock.advance(60_000);
      const again = await saveAs('maintenance', CHANGED.maintenance, 3);
      expect((again.body as RecordBody).value).toMatchObject({
        enabled: true,
        since: '2026-11-08T03:02:00.000Z',
      });
    });

    it('answers a stale save with STALE_VERSION carrying who changed it and the current value', async () => {
      expect((await saveAs('ordering', CHANGED.ordering, 0, OTHER_ADMIN_ID)).status).toBe(200);

      const stale = await saveAs('ordering', { ...SETTING_DEFAULTS.ordering, maxCartLines: 10 }, 0);

      expectProblem(stale, 409, 'STALE_VERSION');
      expect(stale.problem?.['current']).toEqual({
        rowVersion: 1,
        updatedBy: { id: OTHER_ADMIN_ID, name: 'Quản trị Khác' },
        updatedAt: expect.any(String) as unknown,
        value: CHANGED.ordering,
      });
      const all = (await readSettings()).body as Record<string, RecordBody>;
      expect(all['ordering']).toMatchObject({ value: CHANGED.ordering, rowVersion: 1 });
      expect(await auditRows()).toHaveLength(1);
    });

    it('shows only the last five digits of the account in a stale payment answer', async () => {
      expect((await saveAs('payment', PAYMENT, 0, OTHER_ADMIN_ID)).status).toBe(200);

      const stale = await saveAs('payment', SETTING_DEFAULTS.payment, 0);

      expectProblem(stale, 409, 'STALE_VERSION');
      expect(stale.problem?.['current']).toMatchObject({
        rowVersion: 1,
        value: { accountNumberLast5: '12345', bankName: 'Ngân hàng Mẫu' },
      });
      expect(JSON.stringify(stale.body)).not.toContain(ACCOUNT_NUMBER);
    });

    it.each([
      ['brand', { name: '' }, 'brand.name', 'REQUIRED'],
      ['brand', { name: 'a'.repeat(101) }, 'brand.name', 'TOO_LONG'],
      ['brand', { hotline: '02800000001' }, 'brand.hotline', 'INVALID_PHONE'],
      ['brand', { supportEmail: 'support' }, 'brand.supportEmail', 'INVALID_EMAIL'],
      ['brand', { taxCode: '123456789' }, 'brand.taxCode', 'INVALID_TAX_CODE'],
      [
        'brand',
        { receipt: { ...SETTING_DEFAULTS.brand.receipt, title: 'a'.repeat(41) } },
        'brand.receipt.title',
        'TOO_LONG',
      ],
      [
        'brand',
        { receipt: { ...SETTING_DEFAULTS.brand.receipt, footer: 'a\nb\nc\nd\ne' } },
        'brand.receipt.footer',
        'TOO_LONG',
      ],
      [
        'brand',
        { receipt: { ...SETTING_DEFAULTS.brand.receipt, paperWidth: 72 } },
        'brand.receipt.paperWidth',
        'OUT_OF_RANGE',
      ],
      ['reports', { businessDayStartsAt: '25:00' }, 'reports.businessDayStartsAt', 'INVALID_TIME'],
      ['minAppVersion', { ios: '1.2' }, 'minAppVersion.ios', 'INVALID_FORMAT'],
      ['ordering', { maxItemQuantity: 100 }, 'ordering.maxItemQuantity', 'OUT_OF_RANGE'],
      ['ordering', { itemNoteMax: 201 }, 'ordering.itemNoteMax', 'OUT_OF_RANGE'],
      [
        'ordering',
        { boardThresholds: { accept: { warn: 10, late: 10 }, ready: { warn: 15, late: 25 } } },
        'ordering.boardThresholds.accept.warn',
        'MUST_BE_LESS_THAN_LATE',
      ],
      [
        'ordering',
        { readyUnservedWarnMinutes: 10, readyUnservedLateMinutes: 10 },
        'ordering.readyUnservedWarnMinutes',
        'MUST_BE_LESS_THAN_LATE',
      ],
      [
        'ordering',
        { autoCancelUnacceptedMinutes: 10 },
        'ordering.autoCancelUnacceptedMinutes',
        'MUST_EXCEED_ACCEPT_LATE',
      ],
      ['payment', { accountNumber: '0000 12345' }, 'payment.accountNumber', 'INVALID_FORMAT'],
      ['payment', { bankCode: '00001' }, 'payment.bankCode', 'INVALID_FORMAT'],
      ['loyalty', { expiryMonths: 0 }, 'loyalty.expiryMonths', 'OUT_OF_RANGE'],
    ] as const)('refuses %s %j with %s %s', async (key, changes, field, code) => {
      const response = await saveAs(key, { ...CHANGED[key], ...changes }, 0);

      expectProblem(response, 400, 'VALIDATION_FAILED');
      expect(response.problem?.errors).toEqual([
        { field, code, message: expect.any(String) as unknown },
      ]);
      expect(JSON.stringify(response.body)).not.toContain('0000 12345');
      expect(await auditRows()).toEqual([]);
    });

    it.each([
      ['the read-only security block', { key: 'security', value: {}, rowVersion: 0 }, 'key'],
      ['an unknown key', { key: 'reservations', value: {}, rowVersion: 0 }, 'key'],
      [
        'a negative rowVersion',
        { key: 'reports', value: CHANGED.reports, rowVersion: -1 },
        'rowVersion',
      ],
      ['a value that is not an object', { key: 'reports', value: '05:00', rowVersion: 0 }, 'value'],
    ])('refuses %s', async (_case, body, field) => {
      const response = await save(body);

      expectProblem(response, 400, 'VALIDATION_FAILED');
      expect(response.problem?.errors?.map((error) => error.field)).toEqual([field]);
    });

    it('audits settings.change with the storage key, the key name and the value before and after', async () => {
      expect((await saveAs('minAppVersion', CHANGED.minAppVersion, 0)).status).toBe(200);

      expect(await auditRows()).toEqual([
        {
          actor_user_id: ADMIN_ID,
          entity_type: 'APP_SETTINGS',
          entity_id: 'min_app_version',
          entity_label: 'minAppVersion',
          branch_id: null,
          diff: {
            rowVersion: { from: 0, to: 1 },
            before: SETTING_DEFAULTS.minAppVersion,
            after: CHANGED.minAppVersion,
          },
        },
      ]);
    });
  });

  describe('the payment key and its step-up', () => {
    it.each([
      ['no step-up token', undefined],
      ['a token that is not a step-up token', 'not-a-token'],
    ])('refuses a save with %s and writes nothing', async (_case, token) => {
      const response = await save(
        { key: 'payment', value: PAYMENT, rowVersion: 0 },
        { stepUp: token },
      );

      expectProblem(response, 403, 'FORBIDDEN');
      const all = (await readSettings()).body as Record<string, RecordBody>;
      expect(all['payment']?.rowVersion).toBe(0);
      expect(await auditRows()).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('refuses the step-up token of another admin', async () => {
      const response = await save(
        { key: 'payment', value: PAYMENT, rowVersion: 0 },
        { stepUp: await stepUpToken(OTHER_ADMIN_ID) },
      );

      expectProblem(response, 403, 'FORBIDDEN');
    });

    it('does not ask for a step-up token on another key', async () => {
      expect((await save({ key: 'reports', value: CHANGED.reports, rowVersion: 0 })).status).toBe(
        200,
      );
    });

    it('saves with a step-up token, audits only five digits and tells the other active admins', async () => {
      const response = await saveAs('payment', PAYMENT, 0);

      expect(response.status).toBe(200);
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entity_id: 'payment',
        entity_label: 'payment',
        branch_id: null,
        diff: {
          before: { accountNumberLast5: null },
          after: { accountNumberLast5: '12345', bankCode: '000001' },
        },
      });
      expect(JSON.stringify(rows)).not.toContain(ACCOUNT_NUMBER);

      await vi.waitFor(() => {
        expect(sent).toHaveLength(1);
      });
      expect(sent[0]).toMatchObject({
        templateKey: 'PAYMENT_SETTINGS_NOTICE',
        to: OTHER_ADMIN_EMAIL,
      });
      expect(sent[0]?.text).toContain('Quản trị Mẫu');
      expect(sent[0]?.text).toContain('12345');
      expect(sent[0]?.text).not.toContain(ACCOUNT_NUMBER);
    });
  });

  describe('GET /admin/meta/config', () => {
    interface MetaBody {
      user: { id: string; displayName: string; role: string; mfaEnabled: boolean };
      branches: { id: string }[];
      permissions: string[];
      payment: Record<string, unknown>;
    }

    it('gives ADMIN every non-deleted branch and every permission but invoices.manage', async () => {
      const response = await meta(ADMIN_ID, 'ADMIN');

      expect(response.status).toBe(200);
      const body = response.body as MetaBody;
      expect(body.user).toEqual({
        id: ADMIN_ID,
        displayName: 'Quản trị Mẫu',
        role: 'ADMIN',
        mfaEnabled: true,
      });
      expect(body.branches.map((branch) => branch.id)).toEqual([BRANCH_A, BRANCH_B]);
      expect(body.permissions).toContain('admin.settings');
      expect(body.permissions).not.toContain('invoices.manage');
    });

    it('gives STAFF and MANAGER their own branches and their role permissions', async () => {
      const staff = (await meta(STAFF_ID, 'STAFF')).body as MetaBody;
      const manager = (await meta(MANAGER_ID, 'MANAGER')).body as MetaBody;

      expect(staff.branches.map((branch) => branch.id)).toEqual([BRANCH_B]);
      expect(staff.permissions).toEqual(['orders.read', 'orders.write', 'reviews.read']);
      expect(staff.user).toMatchObject({ role: 'STAFF', mfaEnabled: false });
      expect(manager.branches.map((branch) => branch.id)).toEqual([BRANCH_A]);
      expect(manager.permissions).toContain('menu.write');
      expect(manager.permissions.filter((key) => key.startsWith('admin.'))).toEqual([]);
    });

    it('follows a change of branch assignment and of the feature flags on the next call', async () => {
      await query('INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)', [
        STAFF_ID,
        BRANCH_A,
      ]);
      expect(
        (await saveAs('featureFlags', { ...SETTING_DEFAULTS.featureFlags, einvoice: true }, 0))
          .status,
      ).toBe(200);

      const staff = (await meta(STAFF_ID, 'STAFF')).body as MetaBody;
      const admin = (await meta(ADMIN_ID, 'ADMIN')).body as MetaBody;

      expect(staff.branches.map((branch) => branch.id)).toEqual([BRANCH_A, BRANCH_B]);
      expect(admin.permissions).toContain('invoices.manage');
    });

    it('gives staff the transfer details for the counter order and never security or admin-only settings', async () => {
      expect((await saveAs('payment', PAYMENT, 0)).status).toBe(200);
      expect((await saveAs('brand', { ...CHANGED.brand, taxCode: '0000000001' }, 0)).status).toBe(
        200,
      );

      const response = await meta(STAFF_ID, 'STAFF');
      const body = response.body as MetaBody;

      expect(body.payment).toEqual({
        bankName: 'Ngân hàng Mẫu',
        accountNumber: ACCOUNT_NUMBER,
        holder: 'CONG TY MAU',
        bankCode: '000001',
        qrUrl: null,
      });
      const text = JSON.stringify(response.body);
      for (const name of [
        'security',
        'taxCode',
        'supportEmail',
        'minAppVersion',
        'earnVndPerPoint',
      ]) {
        expect(text).not.toContain(name);
      }
    });
  });
});
