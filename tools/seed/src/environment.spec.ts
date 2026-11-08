import { describe, expect, it } from 'vitest';

import { MODES } from './args.js';
import type { SeedMode } from './args.js';
import {
  APP_ENVS,
  assertModeAllowed,
  ConfigError,
  emailDomain,
  readConsentDocumentsFile,
  readFirstAdmin,
  readSeedConfig,
} from './environment.js';
import type { AppEnv, Environment } from './environment.js';

// Fictional local URLs; the password is the repository's local placeholder.
const HOST_URL = 'postgres://kd_migrator:CHANGE_ME_LOCAL@127.0.0.1:5452/kd_dev';
const CONTAINER_URL = 'postgres://kd_migrator:CHANGE_ME_LOCAL@postgres:5432/kd_dev';

function configError(env: Environment): ConfigError {
  try {
    readSeedConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('readSeedConfig: database URL rule (decision 0005 section 2)', () => {
  it('uses DATABASE_URL_MIGRATOR on the host', () => {
    expect(readSeedConfig({ APP_ENV: 'dev', DATABASE_URL_MIGRATOR: HOST_URL })).toEqual({
      appEnv: 'dev',
      databaseUrl: HOST_URL,
    });
  });

  it('uses DATABASE_URL in a container', () => {
    expect(readSeedConfig({ APP_ENV: 'prod', DATABASE_URL: CONTAINER_URL })).toEqual({
      appEnv: 'prod',
      databaseUrl: CONTAINER_URL,
    });
  });

  it('refuses both as ambiguous', () => {
    const error = configError({
      APP_ENV: 'dev',
      DATABASE_URL: CONTAINER_URL,
      DATABASE_URL_MIGRATOR: HOST_URL,
    });
    expect(error.issues).toEqual([
      { name: 'DATABASE_URL, DATABASE_URL_MIGRATOR', rule: 'ambiguous, set only one' },
    ]);
  });

  it('requires one of them', () => {
    expect(configError({ APP_ENV: 'dev' }).issues).toEqual([
      { name: 'DATABASE_URL_MIGRATOR', rule: 'required (DATABASE_URL in a container)' },
    ]);
  });

  it('treats an empty value as unset', () => {
    expect(
      readSeedConfig({ APP_ENV: 'dev', DATABASE_URL: '', DATABASE_URL_MIGRATOR: HOST_URL }),
    ).toMatchObject({ databaseUrl: HOST_URL });
  });

  it.each([
    'not a url',
    'mysql://kd_migrator@127.0.0.1:3306/kd_dev',
    'https://127.0.0.1/kd_dev',
    'postgres://kd_migrator@127.0.0.1:5452',
  ])('refuses %s as not a postgres URL', (url) => {
    expect(configError({ APP_ENV: 'dev', DATABASE_URL_MIGRATOR: url }).issues).toEqual([
      {
        name: 'DATABASE_URL_MIGRATOR',
        rule: 'must be a postgres:// URL with a host and a database',
      },
    ]);
  });

  it('accepts the postgresql:// scheme', () => {
    const url = 'postgresql://kd_migrator@127.0.0.1:5452/kd_dev';
    expect(readSeedConfig({ APP_ENV: 'test', DATABASE_URL_MIGRATOR: url }).databaseUrl).toBe(url);
  });
});

describe('readSeedConfig: APP_ENV', () => {
  it.each(APP_ENVS)('accepts %s', (appEnv) => {
    expect(readSeedConfig({ APP_ENV: appEnv, DATABASE_URL_MIGRATOR: HOST_URL }).appEnv).toBe(
      appEnv,
    );
  });

  it('requires APP_ENV', () => {
    expect(configError({ DATABASE_URL_MIGRATOR: HOST_URL }).issues).toEqual([
      { name: 'APP_ENV', rule: 'required' },
    ]);
  });

  it.each(['production', 'DEV', 'staging', 'local'])('refuses %s', (appEnv) => {
    expect(configError({ APP_ENV: appEnv, DATABASE_URL_MIGRATOR: HOST_URL }).issues).toEqual([
      { name: 'APP_ENV', rule: 'must be one of dev|test|demo|prod' },
    ]);
  });

  it('reports every issue at once', () => {
    expect(configError({}).issues.map((issue) => issue.name)).toEqual([
      'APP_ENV',
      'DATABASE_URL_MIGRATOR',
    ]);
  });
});

describe('assertModeAllowed: the APP_ENV gate of each mode', () => {
  const cases: [SeedMode, AppEnv, boolean][] = [
    ['demo', 'dev', true],
    ['demo', 'test', true],
    ['demo', 'demo', true],
    ['demo', 'prod', false],
    ...APP_ENVS.flatMap((appEnv): [SeedMode, AppEnv, boolean][] => [
      ['reference', appEnv, true],
      ['business', appEnv, true],
    ]),
  ];

  it.each(cases)('seed %s with APP_ENV %s: allowed %s', (mode, appEnv, allowed) => {
    const check = () => assertModeAllowed(mode, MODES[mode].appEnvs, appEnv);
    if (allowed) {
      expect(check).not.toThrow();
    } else {
      expect(check).toThrow(ConfigError);
      expect(check).toThrow('seed demo runs only with APP_ENV dev|test|demo');
    }
  });
});

describe('messages never contain a value', () => {
  const secretUrl = 'postgres://kd_migrator:S3cr3t-Value@db.example.com:5432/kd_dev';

  it.each<[string, Environment]>([
    ['ambiguous', { APP_ENV: 'dev', DATABASE_URL: secretUrl, DATABASE_URL_MIGRATOR: secretUrl }],
    [
      'bad scheme',
      { APP_ENV: 'dev', DATABASE_URL_MIGRATOR: secretUrl.replace('postgres', 'mysql') },
    ],
    [
      'no database',
      { APP_ENV: 'dev', DATABASE_URL: 'postgres://kd_migrator:S3cr3t-Value@db.example.com:5432' },
    ],
    ['bad APP_ENV', { APP_ENV: 'S3cr3t-Value', DATABASE_URL_MIGRATOR: secretUrl }],
  ])('%s', (_label, env) => {
    const error = configError(env);
    expect(error.message).not.toContain('S3cr3t-Value');
    expect(error.message).not.toContain('db.example.com');
    expect(JSON.stringify(error.issues)).not.toContain('S3cr3t-Value');
  });
});

describe('readFirstAdmin: SEED_ADMIN_EMAIL and SEED_ADMIN_NAME', () => {
  // Fictional person on a reserved domain.
  const EMAIL = 'owner@kitchendaylight.example';

  function adminError(env: Environment): ConfigError {
    try {
      readFirstAdmin(env);
    } catch (error) {
      if (error instanceof ConfigError) {
        return error;
      }
      throw error;
    }
    throw new Error('expected a ConfigError');
  }

  it('is null when both are unset or empty: the step is skipped', () => {
    expect(readFirstAdmin({})).toBeNull();
    expect(readFirstAdmin({ SEED_ADMIN_EMAIL: '', SEED_ADMIN_NAME: '' })).toBeNull();
  });

  it('trims and lower-cases the email, trims the name', () => {
    expect(
      readFirstAdmin({
        SEED_ADMIN_EMAIL: '  Owner@KitchenDaylight.example ',
        SEED_ADMIN_NAME: ' Chủ mẫu ',
      }),
    ).toEqual({ email: EMAIL, name: 'Chủ mẫu' });
  });

  it('accepts a name of exactly 60 characters, counted as characters', () => {
    const name = 'Ư'.repeat(60);
    expect(readFirstAdmin({ SEED_ADMIN_EMAIL: EMAIL, SEED_ADMIN_NAME: name })?.name).toBe(name);
  });

  it.each<[string, Environment, string]>([
    ['the email alone', { SEED_ADMIN_EMAIL: EMAIL }, 'SEED_ADMIN_NAME: required'],
    ['the name alone', { SEED_ADMIN_NAME: 'Chủ mẫu' }, 'SEED_ADMIN_EMAIL: required'],
    [
      'an email without a domain dot',
      { SEED_ADMIN_EMAIL: 'owner@localhost', SEED_ADMIN_NAME: 'Chủ mẫu' },
      'SEED_ADMIN_EMAIL: must be an email address',
    ],
    [
      'an email over 254 characters',
      {
        SEED_ADMIN_EMAIL: `${'a'.repeat(250)}@kitchendaylight.example`,
        SEED_ADMIN_NAME: 'Chủ mẫu',
      },
      'SEED_ADMIN_EMAIL: must be an email address',
    ],
    [
      'a blank name',
      { SEED_ADMIN_EMAIL: EMAIL, SEED_ADMIN_NAME: '   ' },
      'SEED_ADMIN_NAME: must be 1 to 60 characters',
    ],
    [
      'a name of 61 characters',
      { SEED_ADMIN_EMAIL: EMAIL, SEED_ADMIN_NAME: 'a'.repeat(61) },
      'SEED_ADMIN_NAME: must be 1 to 60 characters',
    ],
  ])('refuses %s (exit 3)', (_case, env, message) => {
    expect(adminError(env).message).toContain(message);
  });

  it('never puts a value in a message', () => {
    const error = adminError({ SEED_ADMIN_EMAIL: 'S3cr3t-Value', SEED_ADMIN_NAME: 'x'.repeat(61) });
    expect(error.message).not.toContain('S3cr3t-Value');
    expect(JSON.stringify(error.issues)).not.toContain('S3cr3t-Value');
  });

  it('emailDomain keeps the part after the @ only', () => {
    expect(emailDomain(EMAIL)).toBe('kitchendaylight.example');
  });
});

describe('readConsentDocumentsFile: SEED_CONSENT_DOCUMENTS_FILE', () => {
  it('is null when unset or empty: the placeholders are used', () => {
    expect(readConsentDocumentsFile({})).toBeNull();
    expect(readConsentDocumentsFile({ SEED_CONSENT_DOCUMENTS_FILE: '' })).toBeNull();
  });

  it('returns an absolute path', () => {
    expect(
      readConsentDocumentsFile({ SEED_CONSENT_DOCUMENTS_FILE: '/secure/legal/documents.json' }),
    ).toBe('/secure/legal/documents.json');
  });

  it('refuses a relative path (exit 3), without the value in the message', () => {
    expect(() =>
      readConsentDocumentsFile({ SEED_CONSENT_DOCUMENTS_FILE: 'S3cr3t-Value.json' }),
    ).toThrow(ConfigError);
    expect(() =>
      readConsentDocumentsFile({ SEED_CONSENT_DOCUMENTS_FILE: 'S3cr3t-Value.json' }),
    ).not.toThrow(/S3cr3t-Value/u);
  });
});
