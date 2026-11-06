import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { FixedClock } from '../../common/time/testing.js';
import type { AuditService } from '../audit/audit.service.js';
import type { LegalService } from '../legal/legal.service.js';
import { ConsentDocument } from '../users/entities/consent-document.entity.js';
import { User } from '../users/entities/user.entity.js';
import { isLocked } from '../users/lockout.js';
import type { PasswordHasher } from '../users/password-hasher.js';
import { EmailTakenError } from '../users/users.service.js';
import type { UsersService } from '../users/users.service.js';
import {
  acceptsCurrentDocuments,
  appVersionOf,
  AUTH_EVENTS,
  AuthService,
  consentClientOf,
  deviceLabelOf,
} from './auth.service.js';
import type { RegisterInput } from './auth.service.js';
import type { RefreshTokenService, SessionTokens } from './refresh-token.service.js';

const NOW = '2026-11-06T03:00:00.000Z';
const USER_ID = '01930000-0000-7000-8000-000000000a01';
const SESSION_ID = '01930000-0000-7000-8000-000000000a02';
const TERMS_ID = '01930000-0000-7000-8000-000000000d01';
const PRIVACY_ID = '01930000-0000-7000-8000-000000000d02';
const OLD_TERMS_ID = '01930000-0000-7000-8000-000000000d03';

/** Fictional fixture text; never a real credential. */
const PASSPHRASE = 'kd-fixture-passphrase';
/** The fake hasher's "hash": the password with a prefix, so a spec can tell right from wrong. */
const fakeHashOf = (password: string): string => `fake-hash:${password}`;

function document(id: string, type: ConsentDocument['type']): ConsentDocument {
  return Object.assign(new ConsentDocument(), {
    id,
    type,
    version: '1',
    locale: 'vi',
    contentSha256: '0'.repeat(64),
    publishedAt: new Date('2026-10-01T00:00:00.000Z'),
  });
}

const CURRENT_DOCUMENTS = [
  document(PRIVACY_ID, 'PRIVACY_POLICY'),
  document(TERMS_ID, 'TERMS_OF_SERVICE'),
];

function customer(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'fixture-a@kd.example',
    passwordHash: fakeHashOf(PASSPHRASE),
    displayName: 'Người dùng mẫu',
    phone: null,
    avatarUrl: null,
    locale: 'vi',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    preferredBranchId: null,
    emailVerifiedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  });
}

describe('AuthService', () => {
  let clock: FixedClock;
  let stored: User | null;
  let owner: { role: string; status: string } | undefined;
  let em: { update: ReturnType<typeof vi.fn> };
  let dataSource: {
    transaction: ReturnType<typeof vi.fn>;
    manager: { createQueryBuilder: () => unknown };
  };
  let users: {
    findByEmail: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    createCustomer: ReturnType<typeof vi.fn>;
    recordFailedLogin: ReturnType<typeof vi.fn>;
    recordSuccessfulLogin: ReturnType<typeof vi.fn>;
    isLocked: (user: Pick<User, 'lockedUntil'>) => boolean;
  };
  let hasher: {
    verify: ReturnType<typeof vi.fn>;
    verifyOrDummy: ReturnType<typeof vi.fn>;
    needsRehash: ReturnType<typeof vi.fn>;
    hash: ReturnType<typeof vi.fn>;
  };
  let tokens: {
    issue: ReturnType<typeof vi.fn>;
    rotate: ReturnType<typeof vi.fn>;
    revokeByToken: ReturnType<typeof vi.fn>;
    revokeAllForUser: ReturnType<typeof vi.fn>;
  };
  let legal: {
    currentDocuments: ReturnType<typeof vi.fn>;
    recordConsents: ReturnType<typeof vi.fn>;
  };
  let audit: { write: ReturnType<typeof vi.fn> };
  let warn: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;
  let service: AuthService;

  function sessionTokens(role: SessionTokens['role'] = 'CUSTOMER'): SessionTokens {
    return {
      userId: USER_ID,
      role,
      sessionId: SESSION_ID,
      accessToken: 'fake-access-token',
      accessTokenExpiresAt: new Date(clock.now().getTime() + 15 * 60 * 1000),
      refreshToken: 'fake-refresh-token',
      refreshTokenExpiresAt: new Date(clock.now().getTime() + 30 * 24 * 60 * 60 * 1000),
    };
  }

  beforeEach(() => {
    clock = new FixedClock(NOW);
    stored = customer();
    owner = { role: 'CUSTOMER', status: 'ACTIVE' };
    em = { update: vi.fn(() => Promise.resolve({})) };
    const queryBuilder: Record<string, unknown> = {};
    for (const step of ['innerJoin', 'select', 'addSelect', 'where']) {
      queryBuilder[step] = () => queryBuilder;
    }
    queryBuilder['getRawOne'] = () => Promise.resolve(owner);
    dataSource = {
      transaction: vi.fn((work: (manager: unknown) => Promise<unknown>) => work(em)),
      manager: { createQueryBuilder: () => queryBuilder },
    };
    users = {
      findByEmail: vi.fn(() => Promise.resolve(stored)),
      findById: vi.fn(() => Promise.resolve(stored)),
      createCustomer: vi.fn((input: { email: string; displayName: string }) =>
        Promise.resolve(customer({ email: input.email, displayName: input.displayName })),
      ),
      recordFailedLogin: vi.fn(() =>
        Promise.resolve({ counted: true, failedLoginCount: 1, lockedUntil: null }),
      ),
      recordSuccessfulLogin: vi.fn(() => Promise.resolve()),
      isLocked: (user) => isLocked(user, clock.now()),
    };
    hasher = {
      verify: vi.fn((hash: string, password: string) =>
        Promise.resolve(hash === fakeHashOf(password)),
      ),
      verifyOrDummy: vi.fn(() => Promise.resolve(false)),
      needsRehash: vi.fn(() => false),
      hash: vi.fn((password: string) => Promise.resolve(`rehashed:${password}`)),
    };
    tokens = {
      issue: vi.fn(() => Promise.resolve(sessionTokens())),
      rotate: vi.fn(() => Promise.resolve(sessionTokens())),
      revokeByToken: vi.fn(() => Promise.resolve()),
      revokeAllForUser: vi.fn(() => Promise.resolve()),
    };
    legal = {
      currentDocuments: vi.fn(() => Promise.resolve(CURRENT_DOCUMENTS)),
      recordConsents: vi.fn(() => Promise.resolve()),
    };
    audit = { write: vi.fn(() => Promise.resolve()) };
    // Nest's logger, captured and kept quiet.
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    info = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new AuthService(
      dataSource as unknown as DataSource,
      users as unknown as UsersService,
      hasher as unknown as PasswordHasher,
      tokens as unknown as RefreshTokenService,
      legal as unknown as LegalService,
      audit as unknown as AuditService,
      clock,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The first argument (the structured object) of every captured log call. */
  function logged(spy: ReturnType<typeof vi.spyOn>): unknown[] {
    return spy.mock.calls.map((call: unknown[]) => call[0]);
  }

  function registration(overrides: Partial<RegisterInput> = {}): RegisterInput {
    return {
      email: '  Fixture-New@KD.example ',
      password: PASSPHRASE,
      displayName: '  Người dùng mới ',
      acceptedDocumentIds: [TERMS_ID, PRIVACY_ID],
      ...overrides,
    };
  }

  async function caught(work: Promise<unknown>): Promise<ApiError> {
    const error = await work.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  /** What the client sees of an `ApiError`: everything the problem+json body is built from. */
  function visible(error: ApiError): unknown {
    return {
      code: error.code,
      status: error.status,
      detail: error.detail,
      errors: error.errors,
      extras: error.extras,
    };
  }

  describe('register', () => {
    it('creates the customer, one GRANTED consent per current document and a session, in one transaction', async () => {
      const session = await service.register(registration({ deviceLabel: 'Pixel mẫu' }), {
        client: 'mobile-android',
        appVersion: '1.4.0',
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(users.createCustomer).toHaveBeenCalledWith(
        {
          email: 'fixture-new@kd.example',
          password: PASSPHRASE,
          displayName: 'Người dùng mới',
          locale: 'vi',
        },
        em,
      );
      expect(legal.recordConsents).toHaveBeenCalledWith(
        {
          userId: USER_ID,
          documentIds: [PRIVACY_ID, TERMS_ID],
          action: 'GRANTED',
          client: 'MOBILE',
          appVersion: '1.4.0',
        },
        em,
      );
      expect(tokens.issue).toHaveBeenCalledWith(USER_ID, { deviceLabel: 'Pixel mẫu' }, em);
      expect(em.update).not.toHaveBeenCalled();
      expect(session).toEqual({
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
        expiresIn: 900,
        user: {
          id: USER_ID,
          email: 'fixture-new@kd.example',
          displayName: 'Người dùng mới',
          emailVerifiedAt: null,
        },
      });
    });

    it('stores the phone in E.164 in the same transaction', async () => {
      await service.register(registration({ phone: '090 123 4567' }), {});
      expect(em.update).toHaveBeenCalledWith(User, { id: USER_ID }, { phone: '+84901234567' });
    });

    it('treats a blank phone as absent', async () => {
      await service.register(registration({ phone: '  ' }), {});
      expect(em.update).not.toHaveBeenCalled();
    });

    it('refuses a landline with INVALID_PHONE and creates nothing', async () => {
      const error = await caught(service.register(registration({ phone: '02812345678' }), {}));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.errors).toEqual([
        { field: 'phone', code: 'INVALID_PHONE', message: 'must be a Vietnamese mobile number' },
      ]);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('collects the password, display name and document problems in one VALIDATION_FAILED', async () => {
      const error = await caught(
        service.register(
          registration({ password: 'short', displayName: '   ', acceptedDocumentIds: [TERMS_ID] }),
          {},
        ),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.errors?.map((entry) => [entry.field, entry.code])).toEqual([
        ['displayName', 'REQUIRED'],
        ['password', 'TOO_SHORT'],
        ['acceptedDocumentIds', 'INVALID'],
      ]);
      expect(users.createCustomer).not.toHaveBeenCalled();
    });

    it.each([
      ['a stale document id', [OLD_TERMS_ID, PRIVACY_ID]],
      ['a missing document', [TERMS_ID]],
      ['an extra id', [TERMS_ID, PRIVACY_ID, OLD_TERMS_ID]],
      ['a repeated id', [TERMS_ID, PRIVACY_ID, TERMS_ID]],
      ['no id', []],
    ])('refuses %s on acceptedDocumentIds', async (_case, acceptedDocumentIds) => {
      const error = await caught(service.register(registration({ acceptedDocumentIds }), {}));
      expect(error.errors).toEqual([expect.objectContaining({ field: 'acceptedDocumentIds' })]);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('maps a taken email to 409 ALREADY_EXISTS with no detail', async () => {
      users.createCustomer.mockRejectedValueOnce(new EmailTakenError());
      const error = await caught(service.register(registration(), {}));
      expect(visible(error)).toEqual({
        code: 'ALREADY_EXISTS',
        status: 409,
        detail: undefined,
        errors: undefined,
        extras: {},
      });
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('labels the session with X-Client when the body has no deviceLabel', async () => {
      await service.register(registration({ deviceLabel: '  ' }), { client: 'mobile-ios' });
      expect(tokens.issue).toHaveBeenCalledWith(USER_ID, { deviceLabel: 'mobile-ios' }, em);
    });
  });

  describe('login', () => {
    it('signs in an unverified customer: counters cleared, new family, no rehash needed', async () => {
      const session = await service.login(
        { email: 'Fixture-A@KD.example', password: PASSPHRASE },
        { client: 'mobile-ios' },
      );

      expect(hasher.verify).toHaveBeenCalledWith(fakeHashOf(PASSPHRASE), PASSPHRASE);
      expect(users.recordSuccessfulLogin).toHaveBeenCalledWith(USER_ID, em);
      expect(tokens.issue).toHaveBeenCalledWith(USER_ID, { deviceLabel: 'mobile-ios' }, em);
      expect(em.update).not.toHaveBeenCalled();
      expect(users.recordFailedLogin).not.toHaveBeenCalled();
      expect(logged(info)).toEqual([
        { event: AUTH_EVENTS.loginSucceeded, userId: USER_ID, failedLoginCountCleared: 0 },
      ]);
      expect(session.user).toEqual({
        id: USER_ID,
        email: 'fixture-a@kd.example',
        displayName: 'Người dùng mẫu',
        emailVerifiedAt: null,
      });
    });

    it('rehashes when the stored parameters are outdated, only over the verified hash', async () => {
      hasher.needsRehash.mockReturnValueOnce(true);
      await service.login({ email: 'fixture-a@kd.example', password: PASSPHRASE }, {});
      expect(em.update).toHaveBeenCalledWith(
        User,
        { id: USER_ID, passwordHash: fakeHashOf(PASSPHRASE) },
        { passwordHash: `rehashed:${PASSPHRASE}` },
      );
    });

    it('counts a wrong password and answers INVALID_CREDENTIALS', async () => {
      const error = await caught(
        service.login({ email: 'fixture-a@kd.example', password: 'kd-wrong-passphrase' }, {}),
      );
      expect(error.code).toBe('INVALID_CREDENTIALS');
      expect(users.recordFailedLogin).toHaveBeenCalledWith(USER_ID, em);
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
      expect(logged(warn)).toEqual([
        { event: AUTH_EVENTS.loginFailed, userId: USER_ID, failedLoginCount: 1 },
      ]);
    });

    it('audits the lock in the transaction of the failure that caused it', async () => {
      const lockedUntil = new Date('2026-11-06T03:15:00.000Z');
      users.recordFailedLogin.mockResolvedValueOnce({
        counted: true,
        failedLoginCount: 10,
        lockedUntil,
      });
      await caught(
        service.login({ email: 'fixture-a@kd.example', password: 'kd-wrong-passphrase' }, {}),
      );

      expect(audit.write).toHaveBeenCalledWith(
        {
          actorUserId: null,
          action: 'auth.account_locked',
          entityType: 'USER',
          entityId: USER_ID,
          diff: { failedLoginCount: 10, lockedUntil: lockedUntil.toISOString() },
        },
        em,
      );
      expect(logged(warn)).toEqual([
        { event: AUTH_EVENTS.loginFailed, userId: USER_ID, failedLoginCount: 10 },
        { event: AUTH_EVENTS.accountLocked, userId: USER_ID },
      ]);
    });

    it('never logs the password or the email typed', async () => {
      await caught(
        service.login({ email: 'fixture-a@kd.example', password: 'kd-wrong-passphrase' }, {}),
      );
      await service.login({ email: 'fixture-a@kd.example', password: PASSPHRASE }, {});
      const text = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
      expect(text).not.toContain('kd-wrong-passphrase');
      expect(text).not.toContain(PASSPHRASE);
      expect(text).not.toContain('fixture-a@kd.example');
    });

    it.each<[string, () => User | null]>([
      ['an unknown email', () => null],
      ['a staff account', () => customer({ role: 'STAFF' })],
      ['an admin account', () => customer({ role: 'ADMIN' })],
      ['a deleted account', () => customer({ status: 'DELETED' })],
      ['a social-only account', () => customer({ passwordHash: null })],
      ['a locked account', () => customer({ lockedUntil: new Date('2026-11-06T03:15:00.000Z') })],
    ])(
      'runs the dummy verification for %s and answers like a wrong password',
      async (_case, account) => {
        stored = account();
        const refused = await caught(
          service.login({ email: 'fixture-a@kd.example', password: PASSPHRASE }, {}),
        );

        stored = customer();
        const wrongPassword = await caught(
          service.login({ email: 'fixture-a@kd.example', password: 'kd-wrong-passphrase' }, {}),
        );

        expect(visible(refused)).toEqual(visible(wrongPassword));
        expect(hasher.verifyOrDummy).toHaveBeenCalledWith(null, PASSPHRASE);
        expect(hasher.verify).not.toHaveBeenCalledWith(expect.anything(), PASSPHRASE);
        // Only the wrong password of the real customer was counted and logged.
        expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(tokens.issue).not.toHaveBeenCalled();
      },
    );

    it('answers ACCOUNT_SUSPENDED only after the right password', async () => {
      stored = customer({ status: 'SUSPENDED' });
      const right = await caught(
        service.login({ email: 'fixture-a@kd.example', password: PASSPHRASE }, {}),
      );
      expect(right.code).toBe('ACCOUNT_SUSPENDED');
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(users.recordSuccessfulLogin).not.toHaveBeenCalled();

      const wrong = await caught(
        service.login({ email: 'fixture-a@kd.example', password: 'kd-wrong-passphrase' }, {}),
      );
      expect(wrong.code).toBe('INVALID_CREDENTIALS');
      expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
    });

    it('accepts a customer whose lock has ended', async () => {
      stored = customer({
        lockedUntil: new Date('2026-11-06T02:59:59.000Z'),
        failedLoginCount: 10,
      });
      await expect(
        service.login({ email: 'fixture-a@kd.example', password: PASSPHRASE }, {}),
      ).resolves.toMatchObject({ accessToken: 'fake-access-token' });
    });
  });

  describe('refresh', () => {
    it('rotates a customer token and returns the session with the user', async () => {
      clock.advance(60 * 1000);
      tokens.rotate.mockResolvedValueOnce({
        ...sessionTokens(),
        accessTokenExpiresAt: new Date('2026-11-06T03:15:00.000Z'),
      });
      const session = await service.refresh('fake-refresh-token');
      expect(tokens.rotate).toHaveBeenCalledWith('fake-refresh-token');
      expect(session.expiresIn).toBe(14 * 60);
      expect(session.user.id).toBe(USER_ID);
    });

    it.each<[string, { role: string; status: string } | undefined]>([
      ['an unknown token', undefined],
      ['a staff token', { role: 'STAFF', status: 'ACTIVE' }],
      ['a manager token', { role: 'MANAGER', status: 'ACTIVE' }],
      ['a suspended customer', { role: 'CUSTOMER', status: 'SUSPENDED' }],
      ['a deleted customer', { role: 'CUSTOMER', status: 'DELETED' }],
    ])('refuses %s without consuming the token', async (_case, tokenOwner) => {
      owner = tokenOwner;
      const error = await caught(service.refresh('fake-refresh-token'));
      expect(visible(error)).toEqual(visible(new ApiError('UNAUTHENTICATED')));
      expect(tokens.rotate).not.toHaveBeenCalled();
    });

    it('passes a rotation refusal on as UNAUTHENTICATED', async () => {
      tokens.rotate.mockRejectedValueOnce(new ApiError('UNAUTHENTICATED'));
      const error = await caught(service.refresh('fake-refresh-token'));
      expect(error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('logout', () => {
    it('revokes the family of the presented token', async () => {
      await service.logout('fake-refresh-token');
      expect(tokens.revokeByToken).toHaveBeenCalledWith('fake-refresh-token');
    });

    it('revokes every family of the acting user', async () => {
      await service.logoutAll(USER_ID);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
    });
  });
});

describe('consentClientOf', () => {
  it.each([
    [undefined, 'API'],
    ['', 'API'],
    ['mobile-ios', 'MOBILE'],
    ['mobile-android', 'MOBILE'],
    [' Mobile-iOS ', 'MOBILE'],
    ['admin-web', 'ADMIN_WEB'],
    ['curl', 'API'],
  ])('maps X-Client %j to %s', (header, expected) => {
    expect(consentClientOf(header)).toBe(expected);
  });
});

describe('appVersionOf', () => {
  it.each([
    [undefined, null],
    ['1.4.0', '1.4.0'],
    [' 1.4.0+52 ', '1.4.0+52'],
    ['2.0.0-beta.1', '2.0.0-beta.1'],
    ['', null],
    ['1.0 (52)', null],
    ['.1', null],
    ['1'.repeat(33), null],
  ])('reads X-App-Version %j as %j', (header, expected) => {
    expect(appVersionOf(header)).toBe(expected);
  });
});

describe('deviceLabelOf', () => {
  it('prefers the body, then X-Client', () => {
    expect(deviceLabelOf('Pixel mẫu', 'mobile-android')).toBe('Pixel mẫu');
    expect(deviceLabelOf(null, 'mobile-android')).toBe('mobile-android');
    expect(deviceLabelOf('   ', 'mobile-android')).toBe('mobile-android');
    expect(deviceLabelOf(undefined, undefined)).toBeUndefined();
  });
});

describe('acceptsCurrentDocuments', () => {
  it('needs one id per current type and nothing else, without regard to case', () => {
    expect(acceptsCurrentDocuments([TERMS_ID.toUpperCase(), PRIVACY_ID], CURRENT_DOCUMENTS)).toBe(
      true,
    );
    expect(acceptsCurrentDocuments([PRIVACY_ID, TERMS_ID], CURRENT_DOCUMENTS)).toBe(true);
    expect(acceptsCurrentDocuments([TERMS_ID, TERMS_ID], CURRENT_DOCUMENTS)).toBe(false);
  });

  it('refuses everything while a document type has no published version', () => {
    const termsOnly = [document(TERMS_ID, 'TERMS_OF_SERVICE')];
    expect(acceptsCurrentDocuments([TERMS_ID], termsOnly)).toBe(false);
  });
});
