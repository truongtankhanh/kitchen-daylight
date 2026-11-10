import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_ORIGINS_RULE,
  AUTH_RULES,
  DEFAULT_ADMIN_ORIGINS,
  DEFAULT_MAIL_FROM,
  DEFAULT_STORAGE_S3_REGION,
  PLACEHOLDER_PASSWORD_PREFIX,
  STORAGE_RULES,
  STORE_URL_RULE,
} from './config.schema.js';
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

/** A fictional deployed admin origin (decision 0008 section 10). */
const DEPLOYED_ADMIN_ORIGIN = 'https://admin.kitchendaylight.example';

/** Fictional storage names (decision 0009); the bucket names are those of the Docker stack. */
const MEDIA_BUCKET = 'kd-dev-media';
const PRIVATE_BUCKET = 'kd-dev-private';
const DEPLOYED_REGION = 'ap-southeast-1';
const DEPLOYED_PUBLIC_BASE_URL = 'https://media.kitchendaylight.example';

/**
 * Storage against AWS (no endpoint, no static key), named explicitly, so the same values are valid
 * in every tier and the other blocks see no storage issue.
 */
const AWS_STORAGE: Environment = {
  STORAGE_ADAPTER: 's3',
  STORAGE_S3_REGION: DEPLOYED_REGION,
  STORAGE_S3_BUCKET_MEDIA: MEDIA_BUCKET,
  STORAGE_S3_BUCKET_PRIVATE: PRIVATE_BUCKET,
  MEDIA_PUBLIC_BASE_URL: DEPLOYED_PUBLIC_BASE_URL,
};

const VALID_SERVER: Environment = {
  APP_ENV: 'dev',
  PORT: '3001',
  LOG_LEVEL: 'debug',
  DATABASE_URL_APP: APP_URL,
  MAIL_SMTP_HOST: SMTP_HOST,
  MAIL_SMTP_PORT: String(SMTP_PORT),
  ...AWS_STORAGE,
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
        social: { googleClientIds: [], appleClientIds: [] },
      },
      mail: {
        adapter: 'smtp',
        from: DEFAULT_MAIL_FROM,
        smtp: { host: SMTP_HOST, port: SMTP_PORT },
      },
      adminOrigins: ['http://localhost:4200'],
      appStoreUrls: { ios: null, android: null },
      storage: {
        adapter: 's3',
        publicBaseUrl: DEPLOYED_PUBLIC_BASE_URL,
        s3: {
          region: DEPLOYED_REGION,
          endpoint: null,
          forcePathStyle: false,
          credentials: null,
          buckets: { media: MEDIA_BUCKET, private: PRIVATE_BUCKET },
        },
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.storage)).toBe(true);
    expect(Object.isFrozen(config.storage.s3)).toBe(true);
    expect(Object.isFrozen(config.storage.s3.buckets)).toBe(true);
    expect(Object.isFrozen(config.appStoreUrls)).toBe(true);
    expect(Object.isFrozen(config.adminOrigins)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.auth)).toBe(true);
    expect(Object.isFrozen(config.auth.jwt)).toBe(true);
    expect(Object.isFrozen(config.auth.mfaEncryption)).toBe(true);
    expect(Object.isFrozen(config.auth.social)).toBe(true);
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
      [
        'APP_ENV',
        'DATABASE_URL_APP',
        'LOG_LEVEL',
        'PORT',
        'STORAGE_S3_BUCKET_MEDIA',
        'STORAGE_S3_BUCKET_PRIVATE',
        'MEDIA_PUBLIC_BASE_URL',
        ...REQUIRED_AUTH_VARIABLES,
      ].sort(),
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

  it.each(['dev', 'test', 'demo', 'prod'])(
    'leaves the social client ids optional in %s (A2-T6)',
    (appEnv) => {
      const env = {
        ...VALID_SERVER,
        APP_ENV: appEnv,
        // `demo` and `prod` require the mail variables; they are not under test here.
        MAIL_ADAPTER: 'smtp',
        MAIL_FROM: DEFAULT_MAIL_FROM,
        TRUST_PROXY_HOPS: '1',
        ADMIN_ORIGINS: DEPLOYED_ADMIN_ORIGIN,
      };

      expect(loadConfig(env, 'server').auth.social).toEqual({
        googleClientIds: [],
        appleClientIds: [],
      });
    },
  );

  it('splits the social client id lists', () => {
    const env = {
      ...VALID_SERVER,
      GOOGLE_CLIENT_IDS: '1234-ios.apps.googleusercontent.com,1234-web.apps.googleusercontent.com',
      APPLE_CLIENT_IDS: 'com.example.kitchendaylight',
    };

    expect(loadConfig(env, 'server').auth.social).toEqual({
      googleClientIds: [
        '1234-ios.apps.googleusercontent.com',
        '1234-web.apps.googleusercontent.com',
      ],
      appleClientIds: ['com.example.kitchendaylight'],
    });
  });

  it.each([
    ['GOOGLE_CLIENT_IDS', 'with an empty entry', 'a.example,'],
    ['GOOGLE_CLIENT_IDS', 'with a space', 'a.example, b.example'],
    ['APPLE_CLIENT_IDS', 'with a repeated id', 'com.example.app,com.example.app'],
    ['APPLE_CLIENT_IDS', 'with a slash', 'com.example/app'],
  ])('rejects %s %s', (name, _case, value) => {
    expect(issues({ ...VALID_SERVER, [name]: value })).toEqual([
      { name, rule: AUTH_RULES.socialClientIds },
    ]);
  });

  it('is not read by the CLI', () => {
    expect(() => loadConfig(VALID_CLI, 'cli')).not.toThrow();
    expect(loadConfig(VALID_CLI, 'cli')).not.toHaveProperty('auth');
  });
});

describe('loadConfig (ADMIN_ORIGINS)', () => {
  /** What `demo` and `prod` require besides `ADMIN_ORIGINS`. */
  const DEPLOYED: Environment = {
    ...VALID_SERVER,
    TRUST_PROXY_HOPS: '1',
    MAIL_ADAPTER: 'ses',
    MAIL_FROM: DEFAULT_MAIL_FROM,
  };

  it.each(['dev', 'test'])('defaults to the ng serve origin in %s', (appEnv) => {
    expect(loadConfig({ ...VALID_SERVER, APP_ENV: appEnv }, 'server').adminOrigins).toEqual(
      DEFAULT_ADMIN_ORIGINS,
    );
  });

  it.each(['demo', 'prod'])('is required in %s', (appEnv) => {
    expect(issues({ ...DEPLOYED, APP_ENV: appEnv })).toEqual([
      { name: 'ADMIN_ORIGINS', rule: 'required' },
    ]);
  });

  it('splits the list in order; the first entry is the staff link base', () => {
    const env = {
      ...VALID_SERVER,
      ADMIN_ORIGINS:
        'http://localhost:4200,http://127.0.0.1:8080,https://admin.kitchendaylight.example',
    };

    expect(loadConfig(env, 'server').adminOrigins).toEqual([
      'http://localhost:4200',
      'http://127.0.0.1:8080',
      'https://admin.kitchendaylight.example',
    ]);
  });

  it.each(['demo', 'prod'])('accepts https origins in %s', (appEnv) => {
    const env = { ...DEPLOYED, APP_ENV: appEnv, ADMIN_ORIGINS: DEPLOYED_ADMIN_ORIGIN };

    expect(loadConfig(env, 'server').adminOrigins).toEqual([DEPLOYED_ADMIN_ORIGIN]);
  });

  it.each(['demo', 'prod'])('refuses an http origin in %s', (appEnv) => {
    const env = {
      ...DEPLOYED,
      APP_ENV: appEnv,
      ADMIN_ORIGINS: 'http://admin.kitchendaylight.example',
    };

    expect(issues(env)).toEqual([{ name: 'ADMIN_ORIGINS', rule: ADMIN_ORIGINS_RULE }]);
  });

  it.each([
    ['a wildcard', '*'],
    ['a wildcard host', 'https://*.kitchendaylight.example'],
    ['a path', 'https://admin.kitchendaylight.example/login'],
    ['a trailing slash', 'https://admin.kitchendaylight.example/'],
    ['a default port', 'https://admin.kitchendaylight.example:443'],
    ['an upper-case host', 'https://Admin.kitchendaylight.example'],
    ['another scheme', 'ftp://admin.kitchendaylight.example'],
    ['no scheme', 'admin.kitchendaylight.example'],
    ['an empty entry', 'http://localhost:4200,'],
    ['a space', 'http://localhost:4200, http://127.0.0.1:8080'],
    ['a duplicate', 'http://localhost:4200,http://localhost:4200'],
    ['a credential', 'https://leak-check@admin.kitchendaylight.example'],
  ])('refuses %s without echoing it', (_case, value) => {
    const error = failure({ ...VALID_SERVER, ADMIN_ORIGINS: value });

    expect(error.issues).toEqual([{ name: 'ADMIN_ORIGINS', rule: ADMIN_ORIGINS_RULE }]);
    expect(error.message).not.toContain(value);
  });

  it('is not read by the CLI', () => {
    expect(() => loadConfig({ ...VALID_CLI, ADMIN_ORIGINS: '*' }, 'cli')).not.toThrow();
    expect(loadConfig(VALID_CLI, 'cli')).not.toHaveProperty('adminOrigins');
  });
});

describe('loadConfig (store URLs)', () => {
  const IOS = 'https://apps.apple.invalid/app/kitchen-daylight';
  const ANDROID = 'https://play.google.invalid/store/apps/details?id=com.example.kitchendaylight';

  it('maps both store URLs, each optional', () => {
    const config = loadConfig(
      { ...VALID_SERVER, APP_STORE_URL_IOS: IOS, APP_STORE_URL_ANDROID: ANDROID },
      'server',
    );

    expect(config.appStoreUrls).toEqual({ ios: IOS, android: ANDROID });
    expect(loadConfig({ ...VALID_SERVER, APP_STORE_URL_IOS: IOS }, 'server').appStoreUrls).toEqual({
      ios: IOS,
      android: null,
    });
  });

  it.each([
    ['an http URL', 'http://apps.apple.invalid/app/kitchen-daylight'],
    ['no scheme', 'apps.apple.invalid/app/kitchen-daylight'],
    ['not a URL', 'store'],
  ])('refuses %s without echoing it', (_case, value) => {
    const error = failure({ ...VALID_SERVER, APP_STORE_URL_ANDROID: value });

    expect(error.issues).toEqual([{ name: 'APP_STORE_URL_ANDROID', rule: STORE_URL_RULE }]);
    expect(error.message).not.toContain(value);
  });

  it('is not read by the CLI', () => {
    expect(() => loadConfig({ ...VALID_CLI, APP_STORE_URL_IOS: 'store' }, 'cli')).not.toThrow();
  });
});

describe('loadConfig (mail variables)', () => {
  /** What `demo` and `prod` require besides the mail variables (decision 0007 section 5). */
  const DEPLOYED: Environment = {
    ...without(VALID_SERVER, 'APP_ENV'),
    TRUST_PROXY_HOPS: '1',
    ADMIN_ORIGINS: DEPLOYED_ADMIN_ORIGIN,
  };
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

describe('loadConfig (storage variables)', () => {
  const EMULATOR_ENDPOINT = 'http://127.0.0.1:9020';
  // Local placeholders, as `print-env.sh` writes them for the emulator.
  const ACCESS_KEY = `${PLACEHOLDER_PASSWORD_PREFIX}_ACCESS`;
  const SECRET_KEY = `${PLACEHOLDER_PASSWORD_PREFIX}_SECRET`;

  /** The host `.env` of `dev`: the emulator with its keys, nothing named that has a default. */
  const EMULATOR: Environment = {
    ...without(
      without(without(VALID_SERVER, 'STORAGE_ADAPTER'), 'STORAGE_S3_REGION'),
      'MEDIA_PUBLIC_BASE_URL',
    ),
    STORAGE_S3_ENDPOINT: EMULATOR_ENDPOINT,
    STORAGE_S3_FORCE_PATH_STYLE: 'true',
    STORAGE_S3_ACCESS_KEY: ACCESS_KEY,
    STORAGE_S3_SECRET_KEY: SECRET_KEY,
  };

  /** What `demo` and `prod` require besides the storage variables. */
  const DEPLOYED: Environment = {
    ...VALID_SERVER,
    TRUST_PROXY_HOPS: '1',
    MAIL_ADAPTER: 'ses',
    MAIL_FROM: DEFAULT_MAIL_FROM,
    ADMIN_ORIGINS: DEPLOYED_ADMIN_ORIGIN,
  };

  it.each(['dev', 'test'])('maps the emulator with the defaults in %s', (appEnv) => {
    const config = loadConfig({ ...EMULATOR, APP_ENV: appEnv }, 'server');

    expect(config.storage).toEqual({
      adapter: 's3',
      publicBaseUrl: `${EMULATOR_ENDPOINT}/${MEDIA_BUCKET}`,
      s3: {
        region: DEFAULT_STORAGE_S3_REGION,
        endpoint: EMULATOR_ENDPOINT,
        forcePathStyle: true,
        credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
        buckets: { media: MEDIA_BUCKET, private: PRIVATE_BUCKET },
      },
    });
    expect(Object.isFrozen(config.storage.s3.credentials)).toBe(true);
  });

  it('defaults path style to true with an endpoint and reads false', () => {
    const unset = without(EMULATOR, 'STORAGE_S3_FORCE_PATH_STYLE');

    expect(loadConfig(unset, 'server').storage.s3.forcePathStyle).toBe(true);
    expect(
      loadConfig({ ...EMULATOR, STORAGE_S3_FORCE_PATH_STYLE: 'false' }, 'server').storage.s3
        .forcePathStyle,
    ).toBe(false);
  });

  it('ignores path style without an endpoint', () => {
    const env = { ...VALID_SERVER, STORAGE_S3_FORCE_PATH_STYLE: 'true' };

    expect(loadConfig(env, 'server').storage.s3.forcePathStyle).toBe(false);
  });

  it('keeps an explicit MEDIA_PUBLIC_BASE_URL over the derived one, http allowed in dev', () => {
    const lanUrl = 'http://192.168.1.20:9020/kd-dev-media';

    expect(
      loadConfig({ ...EMULATOR, MEDIA_PUBLIC_BASE_URL: lanUrl }, 'server').storage.publicBaseUrl,
    ).toBe(lanUrl);
  });

  it('accepts a public base URL with a path', () => {
    const url = 'https://cdn.kitchendaylight.example/media';

    expect(
      loadConfig({ ...VALID_SERVER, MEDIA_PUBLIC_BASE_URL: url }, 'server').storage.publicBaseUrl,
    ).toBe(url);
  });

  it.each(['demo', 'prod'])('maps AWS with the default provider chain in %s', (appEnv) => {
    expect(loadConfig({ ...DEPLOYED, APP_ENV: appEnv }, 'server').storage).toEqual({
      adapter: 's3',
      publicBaseUrl: DEPLOYED_PUBLIC_BASE_URL,
      s3: {
        region: DEPLOYED_REGION,
        endpoint: null,
        forcePathStyle: false,
        credentials: null,
        buckets: { media: MEDIA_BUCKET, private: PRIVATE_BUCKET },
      },
    });
  });

  it.each(['demo', 'prod'])(
    'requires STORAGE_ADAPTER, STORAGE_S3_REGION and MEDIA_PUBLIC_BASE_URL in %s',
    (appEnv) => {
      const env = without(
        without(without(DEPLOYED, 'STORAGE_ADAPTER'), 'STORAGE_S3_REGION'),
        'MEDIA_PUBLIC_BASE_URL',
      );

      expect(sortedIssues({ ...env, APP_ENV: appEnv })).toEqual([
        { name: 'MEDIA_PUBLIC_BASE_URL', rule: 'required' },
        { name: 'STORAGE_ADAPTER', rule: 'required' },
        { name: 'STORAGE_S3_REGION', rule: 'required' },
      ]);
    },
  );

  it.each(['dev', 'test', 'demo', 'prod'])('requires both buckets in %s', (appEnv) => {
    const env = without(without(DEPLOYED, 'STORAGE_S3_BUCKET_MEDIA'), 'STORAGE_S3_BUCKET_PRIVATE');

    expect(sortedIssues({ ...env, APP_ENV: appEnv })).toEqual([
      { name: 'STORAGE_S3_BUCKET_MEDIA', rule: 'required' },
      { name: 'STORAGE_S3_BUCKET_PRIVATE', rule: 'required' },
    ]);
  });

  it.each(['dev', 'test'])('requires MEDIA_PUBLIC_BASE_URL without an endpoint in %s', (appEnv) => {
    const env = { ...without(VALID_SERVER, 'MEDIA_PUBLIC_BASE_URL'), APP_ENV: appEnv };

    expect(issues(env)).toEqual([{ name: 'MEDIA_PUBLIC_BASE_URL', rule: 'required' }]);
  });

  it('refuses STORAGE_S3_ENDPOINT in prod', () => {
    const env = { ...DEPLOYED, APP_ENV: 'prod', STORAGE_S3_ENDPOINT: EMULATOR_ENDPOINT };

    expect(issues(env)).toEqual([
      { name: 'STORAGE_S3_ENDPOINT', rule: STORAGE_RULES.endpointInProd },
    ]);
  });

  it('accepts an endpoint without keys in demo (decision 0005 section 5)', () => {
    const env = { ...DEPLOYED, APP_ENV: 'demo', STORAGE_S3_ENDPOINT: EMULATOR_ENDPOINT };

    expect(loadConfig(env, 'server').storage.s3.endpoint).toBe(EMULATOR_ENDPOINT);
  });

  it.each(['demo', 'prod'])('refuses static keys in %s', (appEnv) => {
    const env = {
      ...DEPLOYED,
      APP_ENV: appEnv,
      STORAGE_S3_ACCESS_KEY: 'kd-spec-access',
      STORAGE_S3_SECRET_KEY: 'kd-spec-secret',
    };

    expect(sortedIssues(env)).toEqual([
      { name: 'STORAGE_S3_ACCESS_KEY', rule: STORAGE_RULES.keyInDeployedTier },
      { name: 'STORAGE_S3_SECRET_KEY', rule: STORAGE_RULES.keyInDeployedTier },
    ]);
  });

  it.each([
    ['STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY'],
    ['STORAGE_S3_SECRET_KEY', 'STORAGE_S3_ACCESS_KEY'],
  ])('requires %s when %s is set', (missing) => {
    expect(issues(without(EMULATOR, missing))).toEqual([{ name: missing, rule: 'required' }]);
  });

  it('uses the default provider chain with an endpoint and no keys', () => {
    const env = without(without(EMULATOR, 'STORAGE_S3_ACCESS_KEY'), 'STORAGE_S3_SECRET_KEY');

    expect(loadConfig(env, 'server').storage.s3.credentials).toBeNull();
  });

  it.each([
    `${EMULATOR_ENDPOINT}/`,
    `${EMULATOR_ENDPOINT}/kd-dev-media`,
    'http://user:pw@127.0.0.1:9020',
    'ftp://127.0.0.1:9020',
    's3:9020',
    '127.0.0.1:9020',
  ])('rejects the endpoint %s', (endpoint) => {
    expect(issues({ ...EMULATOR, STORAGE_S3_ENDPOINT: endpoint })).toEqual([
      { name: 'STORAGE_S3_ENDPOINT', rule: STORAGE_RULES.endpoint },
    ]);
  });

  it.each(['http://s3:8333', 'https://storage.kitchendaylight.example'])(
    'accepts the endpoint %s',
    (endpoint) => {
      expect(
        loadConfig({ ...EMULATOR, STORAGE_S3_ENDPOINT: endpoint }, 'server').storage.s3.endpoint,
      ).toBe(endpoint);
    },
  );

  it.each(['yes', '1', 'TRUE'])('rejects STORAGE_S3_FORCE_PATH_STYLE=%s', (value) => {
    expect(issues({ ...EMULATOR, STORAGE_S3_FORCE_PATH_STYLE: value })).toEqual([
      { name: 'STORAGE_S3_FORCE_PATH_STYLE', rule: STORAGE_RULES.forcePathStyle },
    ]);
  });

  it.each(['KD-Media', 'kd_media', 'ab', '-kd-media', 'kd-media-'])(
    'rejects the bucket name %s',
    (bucket) => {
      expect(issues({ ...VALID_SERVER, STORAGE_S3_BUCKET_MEDIA: bucket })).toEqual([
        { name: 'STORAGE_S3_BUCKET_MEDIA', rule: STORAGE_RULES.bucket },
      ]);
    },
  );

  it('refuses one bucket for both roles', () => {
    expect(issues({ ...VALID_SERVER, STORAGE_S3_BUCKET_PRIVATE: MEDIA_BUCKET })).toEqual([
      { name: 'STORAGE_S3_BUCKET_PRIVATE', rule: STORAGE_RULES.bucketsDiffer },
    ]);
  });

  it.each(['us-east', 'US-EAST-1', 'eu_west_1', 'ap-southeast-1a'])(
    'rejects STORAGE_S3_REGION=%s',
    (region) => {
      expect(issues({ ...VALID_SERVER, STORAGE_S3_REGION: region })).toEqual([
        { name: 'STORAGE_S3_REGION', rule: STORAGE_RULES.region },
      ]);
    },
  );

  it('rejects an unknown STORAGE_ADAPTER', () => {
    expect(issues({ ...VALID_SERVER, STORAGE_ADAPTER: 'gcs' })).toEqual([
      { name: 'STORAGE_ADAPTER', rule: 'must be one of s3' },
    ]);
  });

  it.each([
    `${DEPLOYED_PUBLIC_BASE_URL}/`,
    `${DEPLOYED_PUBLIC_BASE_URL}?v=1`,
    `${DEPLOYED_PUBLIC_BASE_URL}#media`,
    'https://user:pw@media.kitchendaylight.example',
    'media.kitchendaylight.example',
    'ftp://media.kitchendaylight.example',
  ])('rejects MEDIA_PUBLIC_BASE_URL=%s', (url) => {
    expect(issues({ ...VALID_SERVER, MEDIA_PUBLIC_BASE_URL: url })).toEqual([
      { name: 'MEDIA_PUBLIC_BASE_URL', rule: STORAGE_RULES.publicBaseUrl },
    ]);
  });

  it.each(['demo', 'prod'])('refuses an http MEDIA_PUBLIC_BASE_URL in %s', (appEnv) => {
    const env = {
      ...DEPLOYED,
      APP_ENV: appEnv,
      MEDIA_PUBLIC_BASE_URL: 'http://media.kitchendaylight.example',
    };

    expect(issues(env)).toEqual([
      { name: 'MEDIA_PUBLIC_BASE_URL', rule: STORAGE_RULES.publicBaseUrl },
    ]);
  });

  it('never echoes a storage value', () => {
    const env = {
      ...DEPLOYED,
      APP_ENV: 'prod',
      STORAGE_ADAPTER: 'leak-check-adapter',
      STORAGE_S3_REGION: 'leak-check-region',
      STORAGE_S3_ENDPOINT: 'http://leak-check-endpoint.invalid:9020',
      STORAGE_S3_FORCE_PATH_STYLE: 'leak-check-style',
      STORAGE_S3_ACCESS_KEY: 'leak-check-access',
      STORAGE_S3_SECRET_KEY: 'leak-check-secret',
      STORAGE_S3_BUCKET_MEDIA: 'Leak-Check-Media',
      STORAGE_S3_BUCKET_PRIVATE: 'Leak-Check-Private',
      MEDIA_PUBLIC_BASE_URL: 'http://leak-check-cdn.invalid/',
    };
    const error = failure(env);
    const text = [error.message, ...error.issues.map(({ name, rule }) => `${name} ${rule}`)].join(
      '\n',
    );

    expect(error.issues).toHaveLength(9);
    expect(text).not.toMatch(/leak.check/i);
  });

  it('is not read by the CLI', () => {
    const env = { ...VALID_CLI, STORAGE_ADAPTER: 'gcs', STORAGE_S3_ENDPOINT: 'not a url' };

    expect(loadConfig(env, 'cli')).not.toHaveProperty('storage');
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
    ADMIN_ORIGINS: DEPLOYED_ADMIN_ORIGIN,
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
      ADMIN_ORIGINS: 'leak-check-origin',
    };
    const error = failure(values);
    const text = [error.message, ...error.issues.map(({ name, rule }) => `${name} ${rule}`)].join(
      '\n',
    );

    // The 12 supplied values, plus the two buckets and the public media URL, which are required.
    expect(error.issues).toHaveLength(15);
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
