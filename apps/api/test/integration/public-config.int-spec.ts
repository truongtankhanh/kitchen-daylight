import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { KeySet } from '../../src/modules/auth/key-set.js';
import { signStepUpToken } from '../../src/modules/auth/step-up/step-up.service.js';
import { MailService } from '../../src/modules/mail/mail.service.js';
import type { SettingValues } from '../../src/modules/settings/schema/registry.js';
import type { SettingKey } from '../../src/modules/settings/schema/setting-rules.js';
import { SETTING_DEFAULTS } from '../../src/modules/settings/settings-defaults.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { truncateAll } from '../support/truncate.js';

// A4-T3: `GET /meta/config`, the maintenance and minimum-version gates and the `config.changed`
// outbox row, end to end, as `kd_app`, against real PostgreSQL (brief L9, L12, L13, E18; mobile
// G49, G134). Settings are changed through `PUT /admin/app-settings`, which also invalidates the
// gate snapshot of the app. Fictional data only; the bank details are placeholders.

const NOW = '2026-11-08T03:00:00.000Z';

const META_PATH = '/api/v1/meta/config';
const SETTINGS_PATH = '/api/v1/admin/app-settings';
const PROVINCES_PATH = '/api/v1/provinces';

const ADMIN_ID = '01930000-0000-7000-8000-000000002501';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000002502';
const SESSION_ID = '01930000-0000-7000-8000-0000000025a1';

const INSERT_USER_SQL = `INSERT INTO public.users (id, email, display_name, locale, role, status)
  VALUES ($1, $2, $3, 'vi', $4, 'ACTIVE')`;

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

const MAINTENANCE_ON: SettingValues['maintenance'] = {
  enabled: true,
  message: 'Hệ thống đang bảo trì.',
  expectedBackAt: '2026-11-08T03:10:00.000Z',
  since: '2026-11-08T03:00:00.000Z',
};

const MOBILE_IOS = { 'X-Client': 'mobile-ios' } as const;
const MOBILE_ANDROID = { 'X-Client': 'mobile-android' } as const;

interface OutboxRow {
  type: string;
  audience: string;
  entity_type: string;
  entity_id: string;
  version: number | null;
  branch_id: string | null;
  audience_user_id: string | null;
  payload: Record<string, unknown>;
}

describe('public config and request gates (kd_app, real PostgreSQL)', () => {
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;
  const versions = new Map<SettingKey, number>();

  beforeEach(async () => {
    await truncateAll();
    clock = new FixedClock(NOW);
    testApp = await createTestApp({ clock });
    client = http(testApp.baseUrl);
    versions.clear();
    // The payment notice is not under test here.
    vi.spyOn(testApp.app.get(MailService), 'send').mockResolvedValue(undefined);
    await query(INSERT_USER_SQL, [
      ADMIN_ID,
      'fixture-public-admin@kd.example',
      'Quản trị Mẫu',
      'ADMIN',
    ]);
    await query(INSERT_USER_SQL, [
      CUSTOMER_ID,
      'fixture-public-customer@kd.example',
      'Khách Mẫu',
      'CUSTOMER',
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testApp.close();
  });

  function query<Row>(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    return testApp.dataSource.query(sql, parameters);
  }

  async function bearer(id: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId: id, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  /** Saves a key as the admin, at the version this spec last saw, and remembers the new one. */
  async function saveSetting(key: SettingKey, value: unknown): Promise<TestResponse> {
    const headers = await bearer(ADMIN_ID, 'ADMIN');
    if (key === 'payment') {
      const grant = await signStepUpToken(
        testApp.app.get(KeySet),
        clock.now(),
        ADMIN_ID,
        'settings.payment',
      );
      headers['X-Step-Up-Token'] = grant.stepUpToken;
    }
    const response = await client.request(SETTINGS_PATH, {
      method: 'PUT',
      body: { key, value, rowVersion: versions.get(key) ?? 0 },
      headers,
    });
    if (response.status === 200) {
      versions.set(key, (response.body as { rowVersion: number }).rowVersion);
    }
    return response;
  }

  async function expectSaved(key: SettingKey, value: unknown): Promise<void> {
    expect((await saveSetting(key, value)).status).toBe(200);
  }

  function expectProblem(response: TestResponse, status: number, code: string): void {
    expect({ status: response.status, code: response.problem?.code }).toEqual({ status, code });
  }

  function configOutbox(): Promise<OutboxRow[]> {
    return query(
      `SELECT type, audience::text AS audience, entity_type, entity_id, version,
              branch_id::text AS branch_id, audience_user_id::text AS audience_user_id, payload
         FROM public.outbox_events WHERE type = 'config.changed' ORDER BY created_at, id`,
    );
  }

  describe('GET /meta/config', () => {
    it('answers without a token with the public shape and the defaults', async () => {
      const response = await client.get(META_PATH);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        brand: { name: 'Kitchen Daylight', logoUrl: null, hotline: null },
        minAppVersion: { ios: '0.0.0', android: '0.0.0' },
        maintenance: { enabled: false, message: null, expectedBackAt: null, since: null },
        featureFlags: { ordering: true, delivery: true, reservations: false, loyalty: false },
        ordering: {
          maxItemQuantity: 20,
          maxCartLines: 30,
          itemNoteMax: 200,
          scheduleMinLeadMinutes: 30,
          scheduleMaxDaysAhead: 3,
          callHintMinutes: 10,
          reviewWindowDays: 7,
        },
        payment: { bankTransferEnabled: false },
        loyalty: {
          earnVndPerPoint: null,
          redeemVndPerPoint: null,
          minRedeemPoints: null,
          expiryMonths: null,
        },
        cdnBaseUrl: null,
        mapStyleUrl: null,
        attributions: [],
      });
    });

    it('never shows a bank detail, and bankTransferEnabled follows completeness', async () => {
      await expectSaved('payment', PAYMENT);

      const complete = await client.get(META_PATH);
      expect((complete.body as { payment: unknown }).payment).toEqual({
        bankTransferEnabled: true,
      });
      const text = JSON.stringify(complete.body);
      for (const detail of [
        ACCOUNT_NUMBER,
        'Ngân hàng Mẫu',
        'CONG TY MAU',
        '000001',
        'Mã đơn hàng',
      ]) {
        expect(text).not.toContain(detail);
      }

      await expectSaved('payment', { ...PAYMENT, accountHolder: null });
      const incomplete = await client.get(META_PATH);
      expect((incomplete.body as { payment: unknown }).payment).toEqual({
        bankTransferEnabled: false,
      });
    });

    it('shows the saved brand, flags, limits and rates', async () => {
      await expectSaved('brand', { ...SETTING_DEFAULTS.brand, hotline: '+84281234567' });
      await expectSaved('featureFlags', { ...SETTING_DEFAULTS.featureFlags, loyalty: true });
      await expectSaved('ordering', { ...SETTING_DEFAULTS.ordering, maxCartLines: 25 });
      await expectSaved('loyalty', {
        earnVndPerPoint: 10_000,
        redeemVndPerPoint: 1_000,
        minRedeemPoints: 10,
        expiryMonths: null,
      });

      const body = (await client.get(META_PATH)).body;

      expect(body).toMatchObject({
        brand: { hotline: '+84281234567' },
        featureFlags: { loyalty: true },
        ordering: { maxCartLines: 25 },
        loyalty: { earnVndPerPoint: 10_000, minRedeemPoints: 10, expiryMonths: null },
      });
    });
  });

  describe('maintenance gate', () => {
    beforeEach(async () => {
      await expectSaved('maintenance', MAINTENANCE_ON);
    });

    it('answers 503 MAINTENANCE on a customer path with the message, the time and Retry-After', async () => {
      const response = await client.get(PROVINCES_PATH);

      expectProblem(response, 503, 'MAINTENANCE');
      expect(response.problem).toMatchObject({
        message: 'Hệ thống đang bảo trì.',
        expectedBackAt: '2026-11-08T03:10:00.000Z',
      });
      expect(response.headers.get('retry-after')).toBe('600');
    });

    it('answers a blocked path the same with or without a token', async () => {
      const anonymous = await client.get('/api/v1/me');
      const signedIn = await client.get('/api/v1/me', {
        headers: await bearer(CUSTOMER_ID, 'CUSTOMER'),
      });

      expectProblem(anonymous, 503, 'MAINTENANCE');
      expectProblem(signedIn, 503, 'MAINTENANCE');
    });

    it('leaves /meta/config, /api/health, the staff sign-in and the admin API open', async () => {
      const meta = await client.get(META_PATH);
      expect(meta.status).toBe(200);
      expect((meta.body as { maintenance: unknown }).maintenance).toEqual(MAINTENANCE_ON);

      expect((await client.get('/api/health')).status).toBe(200);

      const login = await client.post(
        '/api/v1/admin/auth/login',
        { email: 'fixture-public-admin@kd.example', password: 'wrong-fixture-passphrase' },
        { headers: { 'X-Client': 'admin-web', Origin: 'http://localhost:4200' } },
      );
      expect(login.problem?.code).not.toBe('MAINTENANCE');
      expect(login.status).not.toBe(503);

      expect(
        (await client.get(SETTINGS_PATH, { headers: await bearer(ADMIN_ID, 'ADMIN') })).status,
      ).toBe(200);
    });

    it('still answers UNAUTHENTICATED on an admin route without a token', async () => {
      expectProblem(await client.get(SETTINGS_PATH), 401, 'UNAUTHENTICATED');
    });

    it('opens again at once when an admin switches it off', async () => {
      await expectSaved('maintenance', SETTING_DEFAULTS.maintenance);

      expect((await client.get(PROVINCES_PATH)).status).toBe(200);
    });
  });

  describe('minimum app version gate', () => {
    beforeEach(async () => {
      await expectSaved('minAppVersion', { ios: '2.0.0', android: '1.5.0' });
    });

    it('answers 400 UPGRADE_REQUIRED to a mobile app below the minimum of its platform', async () => {
      const ios = await client.get(PROVINCES_PATH, {
        headers: { ...MOBILE_IOS, 'X-App-Version': '1.9.9' },
      });
      const android = await client.get(PROVINCES_PATH, {
        headers: { ...MOBILE_ANDROID, 'X-App-Version': '1.4.9' },
      });

      for (const response of [ios, android]) {
        expectProblem(response, 400, 'UPGRADE_REQUIRED');
        // No APP_STORE_URL_* in the test config.
        expect(response.problem?.['storeUrl']).toBeNull();
      }
    });

    it.each([
      ['the minimum itself', { ...MOBILE_ANDROID, 'X-App-Version': '1.5.0' }],
      ['1.10.0 on android', { ...MOBILE_ANDROID, 'X-App-Version': '1.10.0' }],
      ['a higher version', { ...MOBILE_IOS, 'X-App-Version': '2.1.0' }],
      ['no version header', { ...MOBILE_IOS }],
      ['a malformed version', { ...MOBILE_IOS, 'X-App-Version': '1.9' }],
      ['the admin web', { 'X-Client': 'admin-web', 'X-App-Version': '0.0.1' }],
      ['no client header', { 'X-App-Version': '0.0.1' }],
    ])('lets %s through', async (_case, headers) => {
      expect((await client.get(PROVINCES_PATH, { headers })).status).toBe(200);
    });

    it('leaves /meta/config open to an old app, for the forced-update screen', async () => {
      const response = await client.get(META_PATH, {
        headers: { ...MOBILE_IOS, 'X-App-Version': '1.0.0' },
      });

      expect(response.status).toBe(200);
      expect((response.body as { minAppVersion: unknown }).minAppVersion).toEqual({
        ios: '2.0.0',
        android: '1.5.0',
      });
    });
  });

  describe('config.changed', () => {
    it('writes one PUBLIC outbox row per save with the key and the version, never the value', async () => {
      await expectSaved('maintenance', MAINTENANCE_ON);
      await expectSaved('maintenance', SETTING_DEFAULTS.maintenance);

      const rows = await configOutbox();
      expect(rows).toEqual([
        {
          type: 'config.changed',
          audience: 'PUBLIC',
          entity_type: 'app_settings',
          entity_id: 'maintenance',
          version: 1,
          branch_id: null,
          audience_user_id: null,
          payload: { keys: ['maintenance'], version: 1 },
        },
        expect.objectContaining({ version: 2, payload: { keys: ['maintenance'], version: 2 } }),
      ]);
      expect(JSON.stringify(rows)).not.toContain('Hệ thống đang bảo trì.');
    });

    it('names the camelCase key in the payload and the storage key as entity id', async () => {
      await expectSaved('minAppVersion', { ios: '1.0.0', android: '1.0.0' });

      expect(await configOutbox()).toMatchObject([
        { entity_id: 'min_app_version', payload: { keys: ['minAppVersion'], version: 1 } },
      ]);
    });

    it('writes nothing for a stale or an invalid save', async () => {
      await expectSaved('reports', { businessDayStartsAt: '05:00' });
      versions.set('reports', 0);

      expectProblem(
        await saveSetting('reports', { businessDayStartsAt: '06:00' }),
        409,
        'STALE_VERSION',
      );
      expectProblem(
        await saveSetting('ordering', { ...SETTING_DEFAULTS.ordering, maxItemQuantity: 100 }),
        400,
        'VALIDATION_FAILED',
      );
      expect(await configOutbox()).toHaveLength(1);
    });
  });
});
