import { describe, expect, it } from 'vitest';

import { PLACEHOLDER_PASSWORD_PREFIX } from './config.schema.js';
import { ConfigValidationError, loadConfig } from './load-config.js';
import type { ConfigIssue, ConfigKind, Environment } from './load-config.js';

const APP_URL = 'postgres://kd_app@127.0.0.1:5452/kd_dev';
const MIGRATOR_URL = 'postgres://kd_migrator@127.0.0.1:5452/kd_dev';
const PLACEHOLDER_URL = `postgres://kd_app:${PLACEHOLDER_PASSWORD_PREFIX}@127.0.0.1:5452/kd_dev`;

const VALID_SERVER: Environment = {
  APP_ENV: 'dev',
  PORT: '3001',
  LOG_LEVEL: 'debug',
  DATABASE_URL_APP: APP_URL,
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

describe('loadConfig (server)', () => {
  it('maps a valid host environment to a frozen config', () => {
    const config = loadConfig(VALID_SERVER, 'server');

    expect(config).toEqual({
      appEnv: 'dev',
      port: 3001,
      logLevel: 'debug',
      database: { url: APP_URL },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
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

    expect(names.sort()).toEqual(['APP_ENV', 'DATABASE_URL_APP', 'LOG_LEVEL', 'PORT']);
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
  it.each(['dev', 'test'])('is accepted when APP_ENV=%s', (appEnv) => {
    const env = { ...VALID_SERVER, APP_ENV: appEnv, DATABASE_URL_APP: PLACEHOLDER_URL };

    expect(loadConfig(env, 'server').database.url).toBe(PLACEHOLDER_URL);
  });

  it.each(['demo', 'prod'])('is rejected when APP_ENV=%s', (appEnv) => {
    const env = { ...VALID_SERVER, APP_ENV: appEnv, DATABASE_URL_APP: PLACEHOLDER_URL };

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
    expect(() => loadConfig({ ...VALID_SERVER, APP_ENV: 'prod' }, 'server')).not.toThrow();
  });
});

describe('error text', () => {
  it('never contains a value', () => {
    const values = {
      APP_ENV: 'leak-check-app-env',
      PORT: 'leak-check-port',
      LOG_LEVEL: 'leak-check-level',
      DATABASE_URL_APP: 'mysql://leak-check-user:leak-check-secret@leak-check-host/leak-check-db',
    };
    const error = failure(values);
    const text = [error.message, ...error.issues.map(({ name, rule }) => `${name} ${rule}`)].join(
      '\n',
    );

    expect(error.issues).toHaveLength(4);
    expect(text).not.toMatch(/leak-check/);
  });

  it('never contains the placeholder password', () => {
    const error = failure({ ...VALID_SERVER, APP_ENV: 'prod', DATABASE_URL_APP: PLACEHOLDER_URL });

    expect(error.message).not.toContain(PLACEHOLDER_PASSWORD_PREFIX);
    expect(error.message).not.toContain('kd_app');
  });
});
