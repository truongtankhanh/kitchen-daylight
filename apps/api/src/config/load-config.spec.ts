import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AUTH_RULES, DEFAULT_MAIL_FROM, PLACEHOLDER_PASSWORD_PREFIX } from './config.schema.js';
import {
  REQUIRED_AUTH_VARIABLES,
  createEphemeralAuthEnvironment,
} from './ephemeral-auth-environment.js';
import { ConfigValidationError, loadConfig } from './load-config.js';
import type { ConfigIssue, ConfigKind, Environment } from './load-config.js';

const APP_URL = 'postgres://kd_app@127.0.0.1:5452/kd_dev';
const MIGRATOR_URL = 'postgres://kd_migrator@127.0.0.1:5452/kd_dev';
const PLACEHOLDER_URL = `postgres://kd_app:${PLACEHOLDER_PASSWORD_PREFIX}@127.0.0.1:5452/kd_dev`;

// Keys and secrets are generated per run: no key literal is committed (gitleaks, public repository).
const AUTH = createEphemeralAuthEnvironment('kd-spec-');
const OTHER_AUTH = createEphemeralAuthEnvironment('kd-spec-other-');

/** Base64 of the PKCS#8 and SPKI PEM of a key pair of another kind or curve. */
function encodedPair(pair: {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}): Readonly<{ privateKey: string; publicKey: string }> {
  return {
    privateKey: Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString(
      'base64',
    ),
    publicKey: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'pem' })).toString(
      'base64',
    ),
  };
}
const RSA = encodedPair(generateKeyPairSync('rsa', { modulusLength: 2048 }));
const P384 = encodedPair(generateKeyPairSync('ec', { namedCurve: 'secp384r1' }));

const SMTP_HOST = '127.0.0.1';
const SMTP_PORT = 1045;

const VALID_SERVER: Environment = {
  APP_ENV: 'dev',
  PORT: '3001',
  LOG_LEVEL: 'debug',
  DATABASE_URL_APP: APP_URL,
  MAIL_SMTP_HOST: SMTP_HOST,
  MAIL_SMTP_PORT: String(SMTP_PORT),
  ...AUTH,
};

const VALID_CLI: Environment = { APP_ENV: 'dev', DATABASE_URL_MIGRATOR: MIGRATOR_URL };

function without(env: Environment, name: string): Environment {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key !== name));
}

function failure(env: Environment, kind: ConfigKind = 'server'): ConfigValidationError {
  try {
    loadConfig(env, kind);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected loadConfig to fail');
}

function issues(env: Environment, kind: ConfigKind = 'server'): readonly ConfigIssue[] {
  return failure(env, kind).issues;
}

/** Issues sorted by name, for cases with several offending variables. */
function sortedIssues(env: Environment): readonly ConfigIssue[] {
  return [...issues(env)].sort((a, b) => a.name.localeCompare(b.name));
}

describe('loadConfig (server)', () => {
  it('maps a valid host environment to a frozen config', () => {
    const config = loadConfig(VALID_SERVER, 'server');

    expect(config).toEqual({
      appEnv: 'dev',
      port: 3001,
      logLevel: 'debug',
      trustProxyHops: 0,
      database: { url: APP_URL },
      auth: {
        jwt: {
          privateKey: AUTH.JWT_PRIVATE_KEY,
          publicKey: AUTH.JWT_PUBLIC_KEY,
          keyId: AUTH.JWT_KEY_ID,
          previousPublicKeys: [],
        },
        otpHmacSecret: AUTH.OTP_HMAC_SECRET,
        mfaEncryption: { key: AUTH.MFA_ENCRYPTION_KEY, previousKeys: [] },
      },
      mail: {
        adapter: 'smtp',
        from: DEFAULT_MAIL_FROM,
        smtp: { host: SMTP_HOST, port: SMTP_PORT },
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.auth)).toBe(true);
    expect(Object.isFrozen(config.auth.jwt)).toBe(true);
    expect(Object.isFrozen(config.auth.mfaEncryption)).toBe(true);
    expect(Object.isFrozen(config.mail)).toBe(true);
  });

  it('reads DATABASE_URL in a container', () => {
    const env = { ...without(VALID_SERVER, 'DATABASE_URL_APP'), DATABASE_URL: APP_URL };

    expect(loadConfig(env, 'server').database.url).toBe(APP_URL);
  });

  it('ignores the variables the server does not read', () => {
    const env = { ...VALID_SERVER, DATABASE_URL_MIGRATOR: 'not a url', MAIL_UI_URL: 'x' };

    expect(() => loadConfig(env, 'server')).not.toThrow();
  });

  it('requires APP_ENV', () => {
    expect(issues(without(VALID_SERVER, 'APP_ENV'))).toEqual([
      { name: 'APP_ENV', rule: 'required' },
    ]);
  });

  it('requires a database URL', () => {
    expect(issues(without(VALID_SERVER, 'DATABASE_URL_APP'))).toEqual([
      { name: 'DATABASE_URL_APP', rule: 'required (DATABASE_URL in a container)' },
    ]);
  });

  it('defaults PORT to 3000 when missing', () => {
    expect(loadConfig(without(VALID_SERVER, 'PORT'), 'server').port).toBe(3000);
  });

  it('defaults LOG_LEVEL to info when missing', () => {
    expect(loadConfig(without(VALID_SERVER, 'LOG_LEVEL'), 'server').logLevel).toBe('info');
  });

  it('treats an empty value as missing', () => {
    expect(issues({ ...VALID_SERVER, APP_ENV: '' })).toEqual([
      { name: 'APP_ENV', rule: 'required' },
    ]);
  });

  it.each(['production', 'staging', 'DEV'])('rejects APP_ENV=%s', (appEnv) => {
    expect(issues({ ...VALID_SERVER, APP_ENV: appEnv })).toEqual([
      { name: 'APP_ENV', rule: 'must be one of dev|test|demo|prod' },
    ]);
  });

  it.each(['0', '65536', '30.5', 'abc'])('rejects PORT=%s', (port) => {
    expect(issues({ ...VALID_SERVER, PORT: port })).toEqual([
      { name: 'PORT', rule: 'must be an integer from 1 to 65535' },
    ]);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(issues({ ...VALID_SERVER, LOG_LEVEL: 'verbose' })).toEqual([
      { name: 'LOG_LEVEL', rule: 'must be one of fatal|error|warn|info|debug|trace|silent' },
    ]);
  });

  it('rejects a database URL that is not postgres', () => {
    expect(
      issues({ ...VALID_SERVER, DATABASE_URL_APP: 'mysql://kd_app@127.0.0.1/kd_dev' }),
    ).toEqual([{ name: 'DATABASE_URL_APP', rule: 'must be a postgres:// or postgresql:// URL' }]);
  });

  it('rejects DATABASE_URL together with DATABASE_URL_APP as ambiguous', () => {
    expect(issues({ ...VALID_SERVER, DATABASE_URL: APP_URL })).toEqual([
      { name: 'DATABASE_URL, DATABASE_URL_APP', rule: 'ambiguous, set only one' },
    ]);
  });

  it('reports every offending variable at once', () => {
    const names = issues({ PORT: 'abc', LOG_LEVEL: 'verbose' }).map(({ name }) => name);

    expect(names.sort()).toEqual(
      ['APP_ENV', 'DATABASE_URL_APP', 'LOG_LEVEL', 'PORT', ...REQUIRED_AUTH_VARIABLES].sort(),
    );
  });
});

describe('loadConfig (TRUST_PROXY_HOPS)', () => {
  it.each(['dev', 'test'])('defaults to 0 when missing in %s', (appEnv) => {
    expect(loadConfig({ ...VALID_SERVER, APP_ENV: appEnv }, 'server').trustProxyHops).toBe(0);
  });

  it.each(['demo', 'prod'])('is required in %s', (appEnv) => {
    expect(issues({ ...VALID_SERVER, APP_ENV: appEnv })).toContainEqual({
      name: 'TRUST_PROXY_HOPS',
      rule: 'required',
    });
  });

  it.each([
    ['0', 0],
    ['1', 1],
  ])('accepts %s', (value, expected) => {
    expect(loadConfig({ ...VALID_SERVER, TRUST_PROXY_HOPS: value }, 'server').trustProxyHops).toBe(
      expected,
    );
  });

  it.each(['2', '-1', '0.5', 'true', 'leak-check-hops'])(
    'rejects %s without echoing it',
    (value) => {
      const error = failure({ ...VALID_SERVER, TRUST_PROXY_HOPS: value });

      expect(error.issues).toEqual([{ name: 'TRUST_PROXY_HOPS', rule: 'must be 0 or 1' }]);
      expect(error.message).not.toContain(value);
    },
  );

  it('is not read by the CLI', () => {
    expect(() =>
      loadConfig({ ...VALID_CLI, TRUST_PROXY_HOPS: 'not-a-number' }, 'cli'),
    ).not.toThrow();
  });
});

describe('loadConfig (server auth variables)', () => {
  it.each(REQUIRED_AUTH_VARIABLES)('requires %s, on one line naming it', (name) => {
    const error = failure(without(VALID_SERVER, name));

    expect(error.issues).toEqual([{ name, rule: 'required' }]);
    expect(error.message).toBe(`${name}: required`);
  });

  it('accepts and splits the optional previous-key lists', () => {
    const env = {
      ...VALID_SERVER,
      JWT_PREVIOUS_PUBLIC_KEYS: `${OTHER_AUTH.JWT_KEY_ID}:${OTHER_AUTH.JWT_PUBLIC_KEY}`,
      MFA_ENCRYPTION_PREVIOUS_KEYS: OTHER_AUTH.MFA_ENCRYPTION_KEY,
    };

    const { auth } = loadConfig(env, 'server');

    expect(auth.jwt.previousPublicKeys).toEqual([
      { keyId: OTHER_AUTH.JWT_KEY_ID, publicKey: OTHER_AUTH.JWT_PUBLIC_KEY },
    ]);
    expect(auth.mfaEncryption.previousKeys).toEqual([OTHER_AUTH.MFA_ENCRYPTION_KEY]);
  });

  it.each([
    ['JWT_PRIVATE_KEY', 'not base64!', AUTH_RULES.privateKey],
    ['JWT_PRIVATE_KEY', Buffer.from('not a pem').toString('base64'), AUTH_RULES.privateKey],
    ['JWT_PRIVATE_KEY', `${AUTH.JWT_PRIVATE_KEY}\n`, AUTH_RULES.privateKey],
    ['JWT_PUBLIC_KEY', 'not base64!', AUTH_RULES.publicKey],
    ['OTP_HMAC_SECRET', 'not base64!', AUTH_RULES.secret],
    ['MFA_ENCRYPTION_KEY', 'not base64!', AUTH_RULES.encryptionKey],
  ])('rejects bad base64 or a non-PEM value in %s', (name, value, rule) => {
    expect(issues({ ...VALID_SERVER, [name]: value })).toEqual([{ name, rule }]);
  });

  it('rejects a private key given in place of the public key', () => {
    expect(issues({ ...VALID_SERVER, JWT_PUBLIC_KEY: AUTH.JWT_PRIVATE_KEY })).toEqual([
      { name: 'JWT_PUBLIC_KEY', rule: AUTH_RULES.publicKey },
    ]);
  });

  it('rejects a non-EC key pair', () => {
    const env = { ...VALID_SERVER, JWT_PRIVATE_KEY: RSA.privateKey, JWT_PUBLIC_KEY: RSA.publicKey };

    expect(sortedIssues(env)).toEqual([
      { name: 'JWT_PRIVATE_KEY', rule: AUTH_RULES.curve },
      { name: 'JWT_PUBLIC_KEY', rule: AUTH_RULES.curve },
    ]);
  });

  it('rejects an EC key pair on the wrong curve', () => {
    const env = {
      ...VALID_SERVER,
      JWT_PRIVATE_KEY: P384.privateKey,
      JWT_PUBLIC_KEY: P384.publicKey,
    };

    expect(sortedIssues(env)).toEqual([
      { name: 'JWT_PRIVATE_KEY', rule: AUTH_RULES.curve },
      { name: 'JWT_PUBLIC_KEY', rule: AUTH_RULES.curve },
    ]);
  });

  it('rejects a public key that does not belong to the private key', () => {
    expect(issues({ ...VALID_SERVER, JWT_PUBLIC_KEY: OTHER_AUTH.JWT_PUBLIC_KEY })).toEqual([
      { name: 'JWT_PUBLIC_KEY', rule: AUTH_RULES.keyPair },
    ]);
  });

  it.each(['', 'kd dev', 'kd/dev', 'kd:dev', 'k'.repeat(65)])('rejects JWT_KEY_ID=%j', (keyId) => {
    const expected = keyId === '' ? 'required' : AUTH_RULES.keyId;

    expect(issues({ ...VALID_SERVER, JWT_KEY_ID: keyId })).toEqual([
      { name: 'JWT_KEY_ID', rule: expected },
    ]);
  });

  it('rejects a secret shorter than 32 bytes', () => {
    const short = randomBytes(31).toString('base64');

    expect(issues({ ...VALID_SERVER, OTP_HMAC_SECRET: short })).toEqual([
      { name: 'OTP_HMAC_SECRET', rule: AUTH_RULES.secret },
    ]);
  });

  it('accepts a secret longer than 32 bytes', () => {
    const long = randomBytes(64).toString('base64');

    expect(
      loadConfig({ ...VALID_SERVER, OTP_HMAC_SECRET: long }, 'server').auth.otpHmacSecret,
    ).toBe(long);
  });

  it.each([16, 31, 33, 64])('rejects an encryption key of %i bytes', (size) => {
    const key = randomBytes(size).toString('base64');

    expect(issues({ ...VALID_SERVER, MFA_ENCRYPTION_KEY: key })).toEqual([
      { name: 'MFA_ENCRYPTION_KEY', rule: AUTH_RULES.encryptionKey },
    ]);
  });

  it.each([
    ['without a kid', OTHER_AUTH.JWT_PUBLIC_KEY],
    ['with the current kid', `${AUTH.JWT_KEY_ID}:${OTHER_AUTH.JWT_PUBLIC_KEY}`],
    [
      'with a repeated kid',
      `kd-old:${OTHER_AUTH.JWT_PUBLIC_KEY},kd-old:${OTHER_AUTH.JWT_PUBLIC_KEY}`,
    ],
    ['with an empty entry', `kd-old:${OTHER_AUTH.JWT_PUBLIC_KEY},`],
    ['with a key on the wrong curve', `kd-old:${P384.publicKey}`],
  ])('rejects JWT_PREVIOUS_PUBLIC_KEYS %s', (_case, value) => {
    expect(issues({ ...VALID_SERVER, JWT_PREVIOUS_PUBLIC_KEYS: value })).toEqual([
      { name: 'JWT_PREVIOUS_PUBLIC_KEYS', rule: AUTH_RULES.previousPublicKeys },
    ]);
  });

  it.each([
    ['equal to the current key', AUTH.MFA_ENCRYPTION_KEY],
    ['of the wrong size', randomBytes(16).toString('base64')],
    ['with an empty entry', `${OTHER_AUTH.MFA_ENCRYPTION_KEY},`],
  ])('rejects MFA_ENCRYPTION_PREVIOUS_KEYS %s', (_case, value) => {
    expect(issues({ ...VALID_SERVER, MFA_ENCRYPTION_PREVIOUS_KEYS: value })).toEqual([
      { name: 'MFA_ENCRYPTION_PREVIOUS_KEYS', rule: AUTH_RULES.previousEncryptionKeys },
    ]);
  });

  it('is not read by the CLI', () => {
    expect(() => loadConfig(VALID_CLI, 'cli')).not.toThrow();
    expect(loadConfig(VALID_CLI, 'cli')).not.toHaveProperty('auth');
  });
});

describe('loadConfig (mail variables)', () => {
  /** What `demo` and `prod` require besides the mail variables (decision 0007 section 5). */
  const DEPLOYED: Environment = { ...without(VALID_SERVER, 'APP_ENV'), TRUST_PROXY_HOPS: '1' };
  const SES_FROM = 'no-reply@kitchendaylight.example';

  it.each(['dev', 'test'])('defaults to smtp and the fictional sender in %s', (appEnv) => {
    expect(loadConfig({ ...VALID_SERVER, APP_ENV: appEnv }, 'server').mail).toEqual({
      adapter: 'smtp',
      from: DEFAULT_MAIL_FROM,
      smtp: { host: SMTP_HOST, port: SMTP_PORT },
    });
  });

  it.each(['demo', 'prod'])('requires MAIL_ADAPTER and MAIL_FROM in %s', (appEnv) => {
    expect(sortedIssues({ ...DEPLOYED, APP_ENV: appEnv })).toEqual([
      { name: 'MAIL_ADAPTER', rule: 'required' },
      { name: 'MAIL_FROM', rule: 'required' },
    ]);
  });

  it.each(['demo', 'prod'])('accepts ses with a sender and no SMTP address in %s', (appEnv) => {
    const env = {
      ...without(without(DEPLOYED, 'MAIL_SMTP_HOST'), 'MAIL_SMTP_PORT'),
      APP_ENV: appEnv,
      MAIL_ADAPTER: 'ses',
      MAIL_FROM: SES_FROM,
    };

    expect(loadConfig(env, 'server').mail).toEqual({ adapter: 'ses', from: SES_FROM });
  });

  it('ignores the SMTP variables when the adapter is ses', () => {
    const env = { ...VALID_SERVER, MAIL_ADAPTER: 'ses', MAIL_SMTP_PORT: 'not-a-port' };

    expect(loadConfig(env, 'server').mail).toEqual({ adapter: 'ses', from: DEFAULT_MAIL_FROM });
  });

  it.each(['MAIL_SMTP_HOST', 'MAIL_SMTP_PORT'])('requires %s for the smtp adapter', (name) => {
    expect(issues(without(VALID_SERVER, name))).toEqual([{ name, rule: 'required' }]);
  });

  it('requires the SMTP address when smtp is named explicitly in prod', () => {
    const env = {
      ...without(without(DEPLOYED, 'MAIL_SMTP_HOST'), 'MAIL_SMTP_PORT'),
      APP_ENV: 'prod',
      MAIL_ADAPTER: 'smtp',
      MAIL_FROM: SES_FROM,
    };

    expect(sortedIssues(env)).toEqual([
      { name: 'MAIL_SMTP_HOST', rule: 'required' },
      { name: 'MAIL_SMTP_PORT', rule: 'required' },
    ]);
  });

  it.each(['0', '65536', '25.5', 'abc'])('rejects MAIL_SMTP_PORT=%s', (port) => {
    expect(issues({ ...VALID_SERVER, MAIL_SMTP_PORT: port })).toEqual([
      { name: 'MAIL_SMTP_PORT', rule: 'must be an integer from 1 to 65535' },
    ]);
  });

  it.each(['1', '65535', '1025'])('accepts MAIL_SMTP_PORT=%s', (port) => {
    const config = loadConfig({ ...VALID_SERVER, MAIL_SMTP_PORT: port }, 'server');

    expect(config.mail).toMatchObject({ smtp: { port: Number(port) } });
  });

  it.each(['mailpit', 'smtp.example.com', '10.0.0.5'])('accepts MAIL_SMTP_HOST=%s', (host) => {
    const config = loadConfig({ ...VALID_SERVER, MAIL_SMTP_HOST: host }, 'server');

    expect(config.mail).toMatchObject({ smtp: { host } });
  });

  it.each(['smtp://mailpit', 'mail pit', '-mailpit', 'mailpit:1025'])(
    'rejects MAIL_SMTP_HOST=%s',
    (host) => {
      expect(issues({ ...VALID_SERVER, MAIL_SMTP_HOST: host })).toEqual([
        { name: 'MAIL_SMTP_HOST', rule: 'must be a host name or an IPv4 address' },
      ]);
    },
  );

  it('rejects an unknown MAIL_ADAPTER', () => {
    expect(issues({ ...VALID_SERVER, MAIL_ADAPTER: 'sendgrid' })).toEqual([
      { name: 'MAIL_ADAPTER', rule: 'must be one of smtp|ses' },
    ]);
  });

  it.each(['no-reply', 'no-reply@', 'Kitchen <no-reply@kitchendaylight.example>'])(
    'rejects MAIL_FROM=%s',
    (from) => {
      expect(issues({ ...VALID_SERVER, MAIL_FROM: from })).toEqual([
        { name: 'MAIL_FROM', rule: 'must be an email address' },
      ]);
    },
  );

  it('never echoes a mail value', () => {
    const error = failure({
      ...VALID_SERVER,
      MAIL_ADAPTER: 'leak-check-adapter',
      MAIL_FROM: 'leak-check-from',
    });
    const smtpError = failure({
      ...VALID_SERVER,
      MAIL_SMTP_HOST: 'leak check host',
      MAIL_SMTP_PORT: 'leak-check-port',
    });

    expect(error.issues.map(({ name }) => name).sort()).toEqual(['MAIL_ADAPTER', 'MAIL_FROM']);
    expect(smtpError.issues.map(({ name }) => name).sort()).toEqual([
      'MAIL_SMTP_HOST',
      'MAIL_SMTP_PORT',
    ]);
    expect(`${error.message}\n${smtpError.message}`).not.toMatch(/leak.check/);
  });

  it('never reads MAIL_UI_URL', () => {
    const config = loadConfig({ ...VALID_SERVER, MAIL_UI_URL: 'not a url' }, 'server');

    expect(JSON.stringify(config)).not.toContain('not a url');
  });

  it('is not read by the CLI', () => {
    const env = { ...VALID_CLI, MAIL_ADAPTER: 'sendgrid', MAIL_SMTP_PORT: 'abc', MAIL_FROM: 'x' };

    expect(loadConfig(env, 'cli')).not.toHaveProperty('mail');
  });
});

describe('loadConfig (cli)', () => {
  it('maps a valid host environment to a frozen config without server fields', () => {
    const config = loadConfig({ ...VALID_CLI, PORT: 'abc' }, 'cli');

    expect(config).toEqual({ appEnv: 'dev', database: { url: MIGRATOR_URL } });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('requires DATABASE_URL_MIGRATOR on the host', () => {
    expect(issues({ APP_ENV: 'dev', DATABASE_URL_APP: APP_URL }, 'cli')).toEqual([
      { name: 'DATABASE_URL_MIGRATOR', rule: 'required (DATABASE_URL in a container)' },
    ]);
  });

  it('rejects DATABASE_URL together with DATABASE_URL_MIGRATOR as ambiguous', () => {
    expect(issues({ ...VALID_CLI, DATABASE_URL: MIGRATOR_URL }, 'cli')).toEqual([
      { name: 'DATABASE_URL, DATABASE_URL_MIGRATOR', rule: 'ambiguous, set only one' },
    ]);
  });
});

describe('placeholder password', () => {
  /** `VALID_SERVER` plus what `demo` and `prod` also require (decision 0007 section 5, A1-T8). */
  const DEPLOYED_SERVER: Environment = {
    ...VALID_SERVER,
    TRUST_PROXY_HOPS: '1',
    MAIL_ADAPTER: 'ses',
    MAIL_FROM: 'no-reply@kitchendaylight.example',
  };

  it.each(['dev', 'test'])('is accepted when APP_ENV=%s', (appEnv) => {
    const env = { ...VALID_SERVER, APP_ENV: appEnv, DATABASE_URL_APP: PLACEHOLDER_URL };

    expect(loadConfig(env, 'server').database.url).toBe(PLACEHOLDER_URL);
  });

  it.each(['demo', 'prod'])('is rejected when APP_ENV=%s', (appEnv) => {
    const env = { ...DEPLOYED_SERVER, APP_ENV: appEnv, DATABASE_URL_APP: PLACEHOLDER_URL };

    expect(issues(env)).toEqual([
      {
        name: 'DATABASE_URL_APP',
        rule: 'must not embed the placeholder password when APP_ENV is demo or prod',
      },
    ]);
  });

  it.each(['demo', 'prod'])('is rejected for the CLI when APP_ENV=%s', (appEnv) => {
    const url = `postgres://kd_migrator:${PLACEHOLDER_PASSWORD_PREFIX}_X@db:5432/kd`;

    expect(issues({ APP_ENV: appEnv, DATABASE_URL: url }, 'cli').map(({ name }) => name)).toEqual([
      'DATABASE_URL',
    ]);
  });

  it('accepts a URL without the placeholder in prod', () => {
    expect(() => loadConfig({ ...DEPLOYED_SERVER, APP_ENV: 'prod' }, 'server')).not.toThrow();
  });

  const PLACEHOLDER_KEY_ID = `kd-${PLACEHOLDER_PASSWORD_PREFIX}`;

  it.each(['dev', 'test'])('is accepted in an auth value when APP_ENV=%s', (appEnv) => {
    const env = { ...VALID_SERVER, APP_ENV: appEnv, JWT_KEY_ID: PLACEHOLDER_KEY_ID };

    expect(loadConfig(env, 'server').auth.jwt.keyId).toBe(PLACEHOLDER_KEY_ID);
  });

  it.each(['demo', 'prod'])('is rejected in an auth value when APP_ENV=%s', (appEnv) => {
    const env = {
      ...DEPLOYED_SERVER,
      APP_ENV: appEnv,
      JWT_KEY_ID: PLACEHOLDER_KEY_ID,
      OTP_HMAC_SECRET: PLACEHOLDER_PASSWORD_PREFIX,
    };

    expect(sortedIssues(env)).toEqual([
      { name: 'JWT_KEY_ID', rule: AUTH_RULES.placeholder },
      { name: 'OTP_HMAC_SECRET', rule: AUTH_RULES.placeholder },
    ]);
  });
});

describe('error text', () => {
  it('never contains a value', () => {
    const values = {
      APP_ENV: 'leak-check-app-env',
      PORT: 'leak-check-port',
      LOG_LEVEL: 'leak-check-level',
      DATABASE_URL_APP: 'mysql://leak-check-user:leak-check-secret@leak-check-host/leak-check-db',
      JWT_PRIVATE_KEY: 'leak-check-private',
      JWT_PUBLIC_KEY: 'leak-check-public',
      JWT_KEY_ID: 'leak check kid',
      JWT_PREVIOUS_PUBLIC_KEYS: 'leak-check-previous',
      OTP_HMAC_SECRET: 'leak-check-otp',
      MFA_ENCRYPTION_KEY: 'leak-check-mfa',
      MFA_ENCRYPTION_PREVIOUS_KEYS: 'leak-check-mfa-previous',
    };
    const error = failure(values);
    const text = [error.message, ...error.issues.map(({ name, rule }) => `${name} ${rule}`)].join(
      '\n',
    );

    expect(error.issues).toHaveLength(11);
    expect(text).not.toMatch(/leak.check/);
  });

  it('never contains a supplied auth value, valid or not', () => {
    const cases: Environment[] = [
      // Every value valid, but the pair mismatched and the previous lists broken.
      {
        ...VALID_SERVER,
        APP_ENV: 'prod',
        JWT_PUBLIC_KEY: OTHER_AUTH.JWT_PUBLIC_KEY,
        JWT_PREVIOUS_PUBLIC_KEYS: `${AUTH.JWT_KEY_ID}:${OTHER_AUTH.JWT_PUBLIC_KEY}`,
        MFA_ENCRYPTION_PREVIOUS_KEYS: AUTH.MFA_ENCRYPTION_KEY,
      },
      // Keys of the wrong kind and curve, short secrets.
      {
        ...VALID_SERVER,
        JWT_PRIVATE_KEY: RSA.privateKey,
        JWT_PUBLIC_KEY: P384.publicKey,
        OTP_HMAC_SECRET: randomBytes(8).toString('base64'),
        MFA_ENCRYPTION_KEY: randomBytes(8).toString('base64'),
      },
    ];

    for (const env of cases) {
      const error = failure(env);
      const text = [error.message, ...error.issues.map(({ name, rule }) => `${name} ${rule}`)].join(
        '\n',
      );
      const supplied = Object.entries(env)
        .filter(
          ([name]) => name.startsWith('JWT_') || name.includes('SECRET') || name.startsWith('MFA_'),
        )
        .flatMap(([, value]) => (value === undefined ? [] : [value, ...value.split(/[,:]/)]))
        .filter((value) => value.length >= 8);

      expect(error.issues.length).toBeGreaterThan(0);
      for (const value of supplied) {
        expect(text).not.toContain(value);
      }
    }
  });

  it('never contains the placeholder password', () => {
    const error = failure({ ...VALID_SERVER, APP_ENV: 'prod', DATABASE_URL_APP: PLACEHOLDER_URL });

    expect(error.message).not.toContain(PLACEHOLDER_PASSWORD_PREFIX);
    expect(error.message).not.toContain('kd_app');
  });
});
