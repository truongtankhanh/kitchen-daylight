import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../src/common/time/testing.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service.js';
import { MailService } from '../../src/modules/mail/mail.service.js';
import type { MailMessage } from '../../src/modules/mail/ports/mail.port.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { http } from '../support/http.js';
import type { TestHttpClient, TestResponse } from '../support/http.js';
import { insertIdentityFixtures } from '../support/identity-fixtures.js';
import { truncateAll } from '../support/truncate.js';

// A3-T4, testing-strategy "Authorization and ownership" (STAFF cannot do ADMIN actions,
// SELF_CHANGE and LAST_ADMIN), "Staff accounts" (INVITED cannot sign in, resend expires the old
// link, suspension ends sessions, STAFF and MANAGER need a branch), "MFA recovery" and "Staff
// cannot read customer contact details": `/admin/users*` end to end, as `kd_app`, against real
// PostgreSQL. Access tokens are signed directly (the role guard reads the token; the fresh-role
// guard is A3-T6). `MailService.send` records instead of sending. Fictional data only.

const NOW = '2026-11-07T03:00:00.000Z';
const SECOND = 1000;

const ADMIN_ID = '01930000-0000-7000-8000-000000001301';
const OTHER_ADMIN_ID = '01930000-0000-7000-8000-000000001302';
const STAFF_ID = '01930000-0000-7000-8000-000000001303';
const MANAGER_ID = '01930000-0000-7000-8000-000000001304';
const CUSTOMER_ID = '01930000-0000-7000-8000-000000001305';
const INVITED_ID = '01930000-0000-7000-8000-000000001306';
const SESSION_ID = '01930000-0000-7000-8000-0000000013a1';
const BRANCH_A = '01930000-0000-7000-8000-0000000013b1';
const BRANCH_B = '01930000-0000-7000-8000-0000000013b2';
const UNKNOWN_BRANCH = '01930000-0000-7000-8000-0000000013bf';

const ADMIN_EMAIL = 'fixture-users-admin@kd.example';
const STAFF_EMAIL = 'fixture-users-staff@kd.example';
const MANAGER_EMAIL = 'fixture-users-manager@kd.example';
const CUSTOMER_EMAIL = 'fixture-users-customer@kd.example';
const CUSTOMER_PHONE = '+84901234567';
const INVITED_EMAIL = 'fixture-users-invited@kd.example';
const NEW_EMAIL = 'fixture-users-new@kd.example';

/** Fictional fixture text, at least 12 characters; never a real credential. */
const PASSPHRASE = 'kd-fixture-staff-passphrase';
/** A value of the `mfa_credentials_secret_layout` shape; fictional, decrypts to nothing. */
const FAKE_SECRET = `v1.0123456789abcdef.${'A'.repeat(16)}.AAAA.${'A'.repeat(22)}`;

const ADMIN_ORIGIN = 'http://localhost:4200';
const ADMIN_HEADERS = { 'X-Client': 'admin-web', Origin: ADMIN_ORIGIN } as const;

const INSERT_USER_SQL = `INSERT INTO public.users
  (id, email, password_hash, display_name, locale, role, status, phone)
  VALUES ($1, $2, $3, $4, 'vi', $5, $6, $7)`;

interface StaffItem {
  id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  branches: { id: string; code: string }[];
  mfa: { required: boolean; enabled: boolean; enabledAt: string | null };
  lastLoginAt: string | null;
}

interface CustomerItem {
  id: string;
  role: 'CUSTOMER';
  emailMasked: string | null;
  phoneMasked: string | null;
  ordersCount: number;
  lastOrderAt: string | null;
  pointsBalance: number;
  completedOrders: number;
}

interface UserPage {
  items: (StaffItem | CustomerItem)[];
  total: number;
  page: number;
  pageSize: number;
  activeAdminsWithMfa: number;
}

describe('admin users (kd_app, real PostgreSQL)', () => {
  let passwordHash: string;
  let testApp: TestApp;
  let client: TestHttpClient;
  let clock: FixedClock;
  let sent: MailMessage[];

  beforeAll(async () => {
    passwordHash = await new PasswordHasher().hash(PASSPHRASE);
  });

  beforeEach(async () => {
    await truncateAll();
    await insertIdentityFixtures({ branchIds: [BRANCH_A, BRANCH_B] });
    clock = new FixedClock(NOW);
    testApp = await createTestApp({ clock });
    client = http(testApp.baseUrl);
    sent = [];
    vi.spyOn(testApp.app.get(MailService), 'send').mockImplementation((message) => {
      sent.push(message);
      return Promise.resolve('fixture-message-id');
    });
    await insertUser(ADMIN_ID, ADMIN_EMAIL, 'ADMIN', 'ACTIVE', 'Quản trị Mẫu');
    await insertUser(STAFF_ID, STAFF_EMAIL, 'STAFF', 'ACTIVE', 'Nhân Viên An Nhiên');
    await insertUser(MANAGER_ID, MANAGER_EMAIL, 'MANAGER', 'ACTIVE', 'Quản lý Mẫu');
    await insertUser(
      CUSTOMER_ID,
      CUSTOMER_EMAIL,
      'CUSTOMER',
      'ACTIVE',
      'Khách Mẫu',
      CUSTOMER_PHONE,
    );
    await insertUser(INVITED_ID, INVITED_EMAIL, 'STAFF', 'INVITED', 'Nhân viên Mời', null, null);
    await addBranch(STAFF_ID, BRANCH_A);
    await addBranch(MANAGER_ID, BRANCH_B);
    await addBranch(INVITED_ID, BRANCH_A);
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
    role: string,
    status: string,
    displayName: string,
    phone: string | null = null,
    hash: string | null = passwordHash,
  ): Promise<unknown> {
    return query(INSERT_USER_SQL, [id, email, hash, displayName, role, status, phone]);
  }

  function addBranch(userId: string, branchId: string): Promise<unknown> {
    return query('INSERT INTO public.staff_branches (user_id, branch_id) VALUES ($1, $2)', [
      userId,
      branchId,
    ]);
  }

  function enableMfa(userId: string): Promise<unknown> {
    return query(
      `INSERT INTO public.mfa_credentials (user_id, secret_encrypted, enabled_at)
       VALUES ($1, $2, $3)`,
      [userId, FAKE_SECRET, NOW],
    );
  }

  async function bearer(
    role: UserRole = 'ADMIN',
    userId = ADMIN_ID,
  ): Promise<{ headers: Record<string, string> }> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { headers: { authorization: `Bearer ${token}` } };
  }

  async function list(search = ''): Promise<UserPage> {
    const response = await client.get(`/api/v1/admin/users${search}`, await bearer());
    expect(response.status).toBe(200);
    return response.body as UserPage;
  }

  async function patch(
    id: string,
    body: Record<string, unknown>,
    as = ADMIN_ID,
  ): Promise<TestResponse> {
    return client.request(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body,
      ...(await bearer('ADMIN', as)),
    });
  }

  async function action(id: string, name: string, as = ADMIN_ID): Promise<TestResponse> {
    return client.post(`/api/v1/admin/users/${id}/${name}`, undefined, await bearer('ADMIN', as));
  }

  /** A live refresh-token family of the user, as a sign-in would create. */
  async function startSession(userId: string): Promise<string> {
    const issued = await testApp.app.get(RefreshTokenService).issue(userId);
    return issued.refreshToken;
  }

  function liveFamilies(userId: string): Promise<{ total: number }[]> {
    return query(
      `SELECT count(*)::int AS total FROM public.refresh_tokens
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  async function liveCount(userId: string): Promise<number> {
    return (await liveFamilies(userId))[0]?.total ?? 0;
  }

  function outboxRows(): Promise<
    { type: string; audience: string; audience_user_id: string; payload: object }[]
  > {
    return query(
      'SELECT type, audience, audience_user_id, payload FROM public.outbox_events ORDER BY id',
    );
  }

  function auditRows(): Promise<
    {
      action: string;
      actor_user_id: string | null;
      entity_id: string;
      branch_id: string | null;
      diff: object;
    }[]
  > {
    return query(
      `SELECT action, actor_user_id, entity_id, branch_id, diff
         FROM public.audit_logs ORDER BY created_at, id`,
    );
  }

  function expectProblem(response: TestResponse, status: number, code: string): void {
    expect(response.status).toBe(status);
    expect(response.problem?.code).toBe(code);
  }

  describe('authorization', () => {
    it.each(['STAFF', 'MANAGER'] as const)('%s gets FORBIDDEN on every route', async (role) => {
      const as = await bearer(role, role === 'STAFF' ? STAFF_ID : MANAGER_ID);
      const responses = [
        await client.get('/api/v1/admin/users', as),
        await client.post(
          '/api/v1/admin/users',
          { displayName: 'Mới', email: NEW_EMAIL, role: 'ADMIN' },
          as,
        ),
        await client.request(`/api/v1/admin/users/${INVITED_ID}`, {
          method: 'PATCH',
          body: { displayName: 'Mới' },
          ...as,
        }),
        await client.post(`/api/v1/admin/users/${STAFF_ID}/reset-password`, undefined, as),
        await client.post(`/api/v1/admin/users/${INVITED_ID}/resend-invite`, undefined, as),
        await client.post(`/api/v1/admin/users/${ADMIN_ID}/mfa-reset`, undefined, as),
        await client.post(`/api/v1/admin/users/${CUSTOMER_ID}/reveal-contact`, undefined, as),
      ];

      for (const response of responses) {
        expectProblem(response, 403, 'FORBIDDEN');
      }
      expect(await auditRows()).toEqual([]);
      expect(sent).toEqual([]);
    });
  });

  describe('list', () => {
    it('returns staff in full and customers masked, never a full customer contact', async () => {
      await enableMfa(ADMIN_ID);

      const page = await list('?pageSize=50');

      expect(page.total).toBe(5);
      expect(page.activeAdminsWithMfa).toBe(1);
      const staff = page.items.find((item) => item.id === STAFF_ID) as StaffItem;
      expect(staff).toEqual({
        id: STAFF_ID,
        displayName: 'Nhân Viên An Nhiên',
        email: STAFF_EMAIL,
        role: 'STAFF',
        status: 'ACTIVE',
        branches: [{ id: BRANCH_A, code: 'FA' }],
        mfa: { required: false, enabled: false, enabledAt: null },
        lastLoginAt: null,
      });
      const admin = page.items.find((item) => item.id === ADMIN_ID) as StaffItem;
      expect(admin.mfa).toEqual({ required: true, enabled: true, enabledAt: NOW });
      expect(admin.branches).toEqual([]);
      const customer = page.items.find((item) => item.id === CUSTOMER_ID);
      expect(customer).toEqual({
        id: CUSTOMER_ID,
        role: 'CUSTOMER',
        displayName: 'Khách Mẫu',
        emailMasked: 'f***@kd.example',
        phoneMasked: '+84******567',
        status: 'ACTIVE',
        ordersCount: 0,
        lastOrderAt: null,
        pointsBalance: 0,
        completedOrders: 0,
      });

      const body = JSON.stringify(page);
      expect(body).not.toContain(CUSTOMER_EMAIL);
      expect(body).not.toContain(CUSTOMER_PHONE);
    });

    it('finds staff by an accent-insensitive fragment of the name or the email', async () => {
      const byName = await list('?q=nhien');
      const byEmail = await list('?q=users-manager');

      expect(byName.items.map(({ id }) => id)).toEqual([STAFF_ID]);
      expect(byEmail.items.map(({ id }) => id)).toEqual([MANAGER_ID]);
    });

    it('finds customers only by the full email or the full phone', async () => {
      expect((await list('?q=fixture-users-customer')).items).toEqual([]);
      expect((await list('?q=567')).items).toEqual([]);
      expect((await list('?q=Kh%C3%A1ch')).items).toEqual([]);

      const byEmail = await list(`?q=${encodeURIComponent(CUSTOMER_EMAIL.toUpperCase())}`);
      const byPhone = await list('?q=0901234567');

      expect(byEmail.items.map(({ id }) => id)).toEqual([CUSTOMER_ID]);
      expect(byPhone.items.map(({ id }) => id)).toEqual([CUSTOMER_ID]);
    });

    it('filters by scope, roles, status and branch', async () => {
      const staffOnly = await list('?scope=staff&pageSize=50');
      expect(staffOnly.items.map(({ role }) => role)).not.toContain('CUSTOMER');
      expect(staffOnly.total).toBe(4);

      const roles = await list('?roles=MANAGER&roles=ADMIN');
      expect(roles.items.map(({ id }) => id).sort()).toEqual([ADMIN_ID, MANAGER_ID].sort());

      const invited = await list('?status=INVITED');
      expect(invited.items.map(({ id }) => id)).toEqual([INVITED_ID]);

      const branchA = await list(`?branchId=${BRANCH_A}`);
      expect(branchA.items.map(({ id }) => id).sort()).toEqual([STAFF_ID, INVITED_ID].sort());
    });
  });

  describe('create', () => {
    it('creates an INVITED account, sends the invitation and cannot sign in yet', async () => {
      const response = await client.post(
        '/api/v1/admin/users',
        { displayName: ' Nhân viên Mới ', email: NEW_EMAIL, role: 'STAFF', branchIds: [BRANCH_B] },
        await bearer(),
      );

      expect(response.status).toBe(201);
      const created = response.body as StaffItem;
      expect(created).toMatchObject({
        displayName: 'Nhân viên Mới',
        email: NEW_EMAIL,
        role: 'STAFF',
        status: 'INVITED',
        branches: [{ id: BRANCH_B, code: 'FB' }],
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ templateKey: 'STAFF_INVITE', to: NEW_EMAIL });
      const [audit] = await auditRows();
      expect(audit).toMatchObject({
        action: 'user.create',
        actor_user_id: ADMIN_ID,
        entity_id: created.id,
        branch_id: null,
      });
      expect(JSON.stringify(audit)).not.toContain(NEW_EMAIL);

      const login = await client.post(
        '/api/v1/admin/auth/login',
        { email: NEW_EMAIL, password: PASSPHRASE },
        { headers: ADMIN_HEADERS },
      );
      expectProblem(login, 401, 'INVALID_CREDENTIALS');
    });

    it('needs an existing branch for STAFF and MANAGER, none for ADMIN', async () => {
      const as = await bearer();
      const none = await client.post(
        '/api/v1/admin/users',
        { displayName: 'Mới', email: NEW_EMAIL, role: 'MANAGER' },
        as,
      );
      const unknown = await client.post(
        '/api/v1/admin/users',
        { displayName: 'Mới', email: NEW_EMAIL, role: 'STAFF', branchIds: [UNKNOWN_BRANCH] },
        as,
      );
      const admin = await client.post(
        '/api/v1/admin/users',
        { displayName: 'Mới', email: NEW_EMAIL, role: 'ADMIN', branchIds: [BRANCH_A] },
        as,
      );

      expectProblem(none, 400, 'VALIDATION_FAILED');
      expect(none.problem?.errors).toEqual([
        expect.objectContaining({ field: 'branchIds', code: 'REQUIRED' }),
      ]);
      expectProblem(unknown, 400, 'VALIDATION_FAILED');
      expect(unknown.problem?.errors).toEqual([
        expect.objectContaining({ field: 'branchIds', code: 'NOT_FOUND' }),
      ]);
      expect(admin.status).toBe(201);
      expect((admin.body as StaffItem).branches).toEqual([]);
    });

    it('answers ALREADY_EXISTS for an email in use, whatever its case', async () => {
      const response = await client.post(
        '/api/v1/admin/users',
        { displayName: 'Mới', email: STAFF_EMAIL.toUpperCase(), role: 'ADMIN' },
        await bearer(),
      );

      expectProblem(response, 409, 'ALREADY_EXISTS');
      expect(sent).toEqual([]);
    });
  });

  describe('update', () => {
    it('refuses an admin changing their own role, status or branches (SELF_CHANGE)', async () => {
      expectProblem(await patch(ADMIN_ID, { role: 'MANAGER' }), 403, 'SELF_CHANGE');
      expectProblem(await patch(ADMIN_ID, { status: 'SUSPENDED' }), 403, 'SELF_CHANGE');

      const rename = await patch(ADMIN_ID, { displayName: 'Tên Mới' });
      expect(rename.status).toBe(200);
      expect((rename.body as StaffItem).displayName).toBe('Tên Mới');
    });

    it('refuses a change that leaves no ACTIVE admin (LAST_ADMIN)', async () => {
      // The actor's token is still ADMIN while the account was suspended meanwhile (the
      // fresh-role guard is A3-T6): the target is then the only active admin.
      await insertUser(
        OTHER_ADMIN_ID,
        'fixture-users-other-admin@kd.example',
        'ADMIN',
        'SUSPENDED',
        'Quản trị Khác',
      );

      const demote = await patch(
        ADMIN_ID,
        { role: 'STAFF', branchIds: [BRANCH_A] },
        OTHER_ADMIN_ID,
      );
      const suspend = await patch(ADMIN_ID, { status: 'SUSPENDED' }, OTHER_ADMIN_ID);

      expectProblem(demote, 409, 'LAST_ADMIN');
      expectProblem(suspend, 409, 'LAST_ADMIN');
      expect(
        (
          await query<{ role: string }>('SELECT role FROM public.users WHERE id = $1', [ADMIN_ID])
        )[0]?.role,
      ).toBe('ADMIN');
    });

    it('a role change revokes every session and writes session.revoked to the outbox', async () => {
      await startSession(STAFF_ID);
      await startSession(STAFF_ID);
      expect(await liveCount(STAFF_ID)).toBe(2);

      const response = await patch(STAFF_ID, { role: 'MANAGER' });

      expect(response.status).toBe(200);
      expect((response.body as StaffItem).mfa.required).toBe(true);
      expect(await liveCount(STAFF_ID)).toBe(0);
      expect(await outboxRows()).toEqual([
        {
          type: 'session.revoked',
          audience: 'USER',
          audience_user_id: STAFF_ID,
          payload: { userId: STAFF_ID, reason: 'ROLE_CHANGE' },
        },
      ]);
      expect(await auditRows()).toEqual([
        expect.objectContaining({
          action: 'user.role_change',
          actor_user_id: ADMIN_ID,
          branch_id: null,
          diff: { role: { from: 'STAFF', to: 'MANAGER' } },
        }),
      ]);
    });

    it('a suspension ends the sessions and emits user.suspended; re-enabling ends nothing', async () => {
      await startSession(STAFF_ID);

      const suspend = await patch(STAFF_ID, { status: 'SUSPENDED' });

      expect(suspend.status).toBe(200);
      expect(await liveCount(STAFF_ID)).toBe(0);
      expect((await outboxRows()).map(({ type }) => type)).toEqual(['user.suspended']);

      const enable = await patch(STAFF_ID, { status: 'ACTIVE' });
      expect(enable.status).toBe(200);
      expect((await outboxRows()).map(({ type }) => type)).toEqual(['user.suspended']);
      expect((await auditRows()).map(({ action }) => action)).toEqual([
        'user.disable',
        'user.enable',
      ]);
    });

    it('a branch change keeps the sessions and is audited', async () => {
      await startSession(STAFF_ID);

      const response = await patch(STAFF_ID, { branchIds: [BRANCH_A, BRANCH_B] });

      expect(response.status).toBe(200);
      expect((response.body as StaffItem).branches.map(({ code }) => code)).toEqual(['FA', 'FB']);
      expect(await liveCount(STAFF_ID)).toBe(1);
      expect(await outboxRows()).toEqual([]);
      expect((await auditRows()).map(({ action }) => action)).toEqual(['user.branch_change']);
      expectProblem(await patch(STAFF_ID, { branchIds: [] }), 400, 'VALIDATION_FAILED');
    });

    it('accepts only status for a customer account', async () => {
      const rename = await patch(CUSTOMER_ID, { displayName: 'Tên khác' });
      expectProblem(rename, 400, 'VALIDATION_FAILED');

      const suspend = await patch(CUSTOMER_ID, { status: 'SUSPENDED' });
      expect(suspend.status).toBe(200);
      expect(suspend.body).toMatchObject({ role: 'CUSTOMER', status: 'SUSPENDED' });
      expect(JSON.stringify(suspend.body)).not.toContain(CUSTOMER_EMAIL);
    });

    it('does not activate an invited account; withdrawing the invitation is allowed', async () => {
      expectProblem(await patch(INVITED_ID, { status: 'ACTIVE' }), 409, 'INVALID_STATE');
      expect((await patch(INVITED_ID, { status: 'SUSPENDED' })).status).toBe(200);
    });

    it('re-enabling a withdrawn invitation reinstates it and sends a new link', async () => {
      expect((await patch(INVITED_ID, { status: 'SUSPENDED' })).status).toBe(200);

      const enable = await patch(INVITED_ID, { status: 'ACTIVE' });

      expect(enable.status).toBe(200);
      expect((enable.body as StaffItem).status).toBe('INVITED');
      expect(sent).toEqual([
        expect.objectContaining({ templateKey: 'STAFF_INVITE', to: INVITED_EMAIL }),
      ]);
      expect((await auditRows()).map(({ diff }) => diff)).toEqual([
        { status: { from: 'INVITED', to: 'SUSPENDED' } },
        { status: { from: 'SUSPENDED', to: 'INVITED' } },
      ]);
    });

    it('answers NOT_FOUND for an unknown id', async () => {
      expectProblem(
        await patch('01930000-0000-7000-8000-0000000013ff', { displayName: 'X' }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('links', () => {
    it('resend-invite expires the old link and allows one resend per 60 s', async () => {
      expect((await action(INVITED_ID, 'resend-invite')).status).toBe(204);

      const tooSoon = await action(INVITED_ID, 'resend-invite');
      expectProblem(tooSoon, 429, 'RATE_LIMITED');
      expect(tooSoon.headers.get('retry-after')).toBe('60');

      clock.advance(60 * SECOND);
      expect((await action(INVITED_ID, 'resend-invite')).status).toBe(204);

      const links = await query<{ used_at: Date | null }>(
        `SELECT used_at FROM public.email_tokens WHERE user_id = $1 AND type = 'INVITE'
          ORDER BY created_at`,
        [INVITED_ID],
      );
      expect(links).toHaveLength(2);
      expect(links[0]?.used_at).not.toBeNull();
      expect(links[1]?.used_at).toBeNull();
      expect(sent.map(({ templateKey }) => templateKey)).toEqual(['STAFF_INVITE', 'STAFF_INVITE']);
      expect((await auditRows()).map(({ action: code }) => code)).toEqual([
        'user.invite_resend',
        'user.invite_resend',
      ]);
    });

    it('answers RATE_LIMITED beyond 5 links in 24 hours, with the wait until one leaves', async () => {
      for (const hours of [23, 12, 6, 2, 1]) {
        const createdAt = new Date(clock.now().getTime() - hours * 60 * 60 * SECOND);
        await query(
          `INSERT INTO public.email_tokens
             (user_id, type, channel, token_hash, target_email, max_attempts, created_at,
              expires_at, used_at)
           VALUES ($1, 'INVITE', 'LINK', $2, $3, 1, $4, $4::timestamptz + interval '48 hours', $4)`,
          [INVITED_ID, Buffer.alloc(32, hours), INVITED_EMAIL, createdAt.toISOString()],
        );
      }

      const capped = await action(INVITED_ID, 'resend-invite');

      expectProblem(capped, 429, 'RATE_LIMITED');
      expect(capped.headers.get('retry-after')).toBe('3600');
      expect(sent).toEqual([]);
      expect(await auditRows()).toEqual([]);
    });

    it('resend-invite is INVALID_STATE for an account no longer invited', async () => {
      expectProblem(await action(STAFF_ID, 'resend-invite'), 409, 'INVALID_STATE');
      expect(sent).toEqual([]);
    });

    it('reset-password sends a reset link to an ACTIVE account and refuses an INVITED one', async () => {
      expect((await action(STAFF_ID, 'reset-password')).status).toBe(204);
      expect(sent[0]).toMatchObject({ templateKey: 'STAFF_PASSWORD_RESET', to: STAFF_EMAIL });
      expect((await auditRows()).map(({ action: code }) => code)).toEqual([
        'user.password_reset_send',
      ]);

      expectProblem(await action(INVITED_ID, 'reset-password'), 409, 'INVALID_STATE');
      expectProblem(await action(CUSTOMER_ID, 'reset-password'), 409, 'INVALID_STATE');
    });
  });

  describe('mfa-reset', () => {
    it('is never allowed on oneself', async () => {
      await enableMfa(ADMIN_ID);

      expectProblem(await action(ADMIN_ID, 'mfa-reset'), 403, 'SELF_CHANGE');
      expect(await query('SELECT user_id FROM public.mfa_credentials')).toHaveLength(1);
    });

    it('is MFA_NOT_ENABLED for an account without a confirmed second factor', async () => {
      expectProblem(await action(STAFF_ID, 'mfa-reset'), 409, 'MFA_NOT_ENABLED');
      expectProblem(await action(MANAGER_ID, 'mfa-reset'), 409, 'MFA_NOT_ENABLED');
      expect(await auditRows()).toEqual([]);
    });

    it('deletes the credential, ends the sessions, emits session.revoked, audits and mails', async () => {
      await enableMfa(MANAGER_ID);
      await startSession(MANAGER_ID);

      const response = await action(MANAGER_ID, 'mfa-reset');

      expect(response.status).toBe(204);
      expect(
        await query('SELECT user_id FROM public.mfa_credentials WHERE user_id = $1', [MANAGER_ID]),
      ).toEqual([]);
      expect(await liveCount(MANAGER_ID)).toBe(0);
      expect(await outboxRows()).toEqual([
        {
          type: 'session.revoked',
          audience: 'USER',
          audience_user_id: MANAGER_ID,
          payload: { userId: MANAGER_ID, reason: 'MFA_RESET' },
        },
      ]);
      expect(await auditRows()).toEqual([
        expect.objectContaining({
          action: 'user.mfa_reset',
          actor_user_id: ADMIN_ID,
          entity_id: MANAGER_ID,
          diff: { mfaEnabled: { from: true, to: false } },
        }),
      ]);
      expect(sent).toEqual([
        expect.objectContaining({ templateKey: 'MFA_RESET_NOTICE', to: MANAGER_EMAIL }),
      ]);
    });
  });

  describe('reveal-contact', () => {
    it('returns the full contact and writes an audit row without it', async () => {
      const response = await action(CUSTOMER_ID, 'reveal-contact');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ email: CUSTOMER_EMAIL, phone: CUSTOMER_PHONE });
      const rows = await auditRows();
      expect(rows).toEqual([
        {
          action: 'order.contact_reveal',
          actor_user_id: ADMIN_ID,
          entity_id: CUSTOMER_ID,
          branch_id: null,
          diff: {},
        },
      ]);
      const entity = await query<{ entity_type: string }>(
        'SELECT entity_type FROM public.audit_logs',
      );
      expect(entity[0]?.entity_type).toBe('USER');
      expect(JSON.stringify(rows)).not.toContain(CUSTOMER_PHONE);
    });
  });
});
