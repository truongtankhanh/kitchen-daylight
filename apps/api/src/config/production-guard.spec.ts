import { describe, expect, it } from 'vitest';

import { ADAPTER_KINDS } from './adapter-kind.js';
import type { AdapterKind } from './adapter-kind.js';
import { APP_ENVS } from './config.schema.js';
import type { AppEnv } from './config.schema.js';
import { createEphemeralAuthEnvironment } from './ephemeral-auth-environment.js';
import { loadConfig } from './load-config.js';
import type { Environment, ServerConfig } from './load-config.js';
import {
  describeViolation,
  evaluateProductionGuard,
  GUARDED_VARIABLES,
  productionGuardViolations,
  serverGuardedVariables,
  serverPortBindings,
} from './production-guard.js';
import type { GuardedVariable, ProductionGuardViolation } from './production-guard.js';

// Decision 0005, section 5: the only refused cells of kind × tier.
const REFUSED: readonly (readonly [AppEnv, AdapterKind])[] = [
  ['prod', 'emulator'],
  ['prod', 'fixture'],
  ['test', 'real'],
];

const CELLS = APP_ENVS.flatMap((appEnv) =>
  ADAPTER_KINDS.map((kind) => ({
    appEnv,
    kind,
    refused: REFUSED.some(([env, refusedKind]) => env === appEnv && refusedKind === kind),
  })),
);

// Decision 0005, sections 2 and 5 (A6-T2): the only refused cells of guarded variable × tier.
const REFUSED_VARIABLE_CELLS: readonly (readonly [AppEnv, GuardedVariable])[] = [
  ['demo', 'STORAGE_S3_ACCESS_KEY'],
  ['demo', 'STORAGE_S3_SECRET_KEY'],
  ['prod', 'STORAGE_S3_ENDPOINT'],
  ['prod', 'STORAGE_S3_ACCESS_KEY'],
  ['prod', 'STORAGE_S3_SECRET_KEY'],
];

const VARIABLE_CELLS = APP_ENVS.flatMap((appEnv) =>
  GUARDED_VARIABLES.map((variable) => ({
    appEnv,
    variable,
    refused: REFUSED_VARIABLE_CELLS.some(([env, name]) => env === appEnv && name === variable),
  })),
);

/** The port or the variable a violation names. */
function subject(violation: ProductionGuardViolation): string {
  return 'variable' in violation ? violation.variable : violation.port;
}

describe('evaluateProductionGuard (per tier)', () => {
  it('covers three kinds in four tiers', () => {
    expect(CELLS).toHaveLength(12);
    expect(CELLS.filter(({ refused }) => refused)).toHaveLength(3);
  });

  // Every cell uses a synthetic binding of that kind.
  it.each(CELLS)('$appEnv with a $kind binding: refused=$refused', ({ appEnv, kind, refused }) => {
    const binding = { port: 'MailPort', adapter: `synthetic-${kind}`, kind };

    const violations = evaluateProductionGuard({ appEnv, bindings: [binding] });

    expect(violations).toEqual(refused ? [{ ...binding, appEnv }] : []);
  });

  it('covers three guarded variables in four tiers', () => {
    expect(VARIABLE_CELLS).toHaveLength(12);
    expect(VARIABLE_CELLS.filter(({ refused }) => refused)).toHaveLength(5);
  });

  it.each(VARIABLE_CELLS)(
    '$appEnv with $variable set: refused=$refused',
    ({ appEnv, variable, refused }) => {
      const violations = evaluateProductionGuard({
        appEnv,
        bindings: [],
        setVariables: [variable],
      });

      expect(violations).toEqual(refused ? [{ variable, appEnv }] : []);
    },
  );

  it('reports each refused binding, then each refused variable, and keeps the accepted ones out', () => {
    const bindings = [
      { port: 'MailPort', adapter: 'smtp', kind: 'emulator' as const },
      { port: 'StoragePort', adapter: 'synthetic-real', kind: 'real' as const },
      { port: 'GeocodePort', adapter: 'synthetic-fixture', kind: 'fixture' as const },
    ];

    const violations = evaluateProductionGuard({
      appEnv: 'prod',
      bindings,
      setVariables: ['STORAGE_S3_SECRET_KEY'],
    });

    expect(violations.map(subject)).toEqual(['MailPort', 'GeocodePort', 'STORAGE_S3_SECRET_KEY']);
  });

  it('accepts an empty input in every tier', () => {
    for (const appEnv of APP_ENVS) {
      expect(evaluateProductionGuard({ appEnv, bindings: [] })).toEqual([]);
    }
  });

  it('describes a variable by its name and APP_ENV only', () => {
    expect(describeViolation({ variable: 'STORAGE_S3_ENDPOINT', appEnv: 'prod' })).toBe(
      'STORAGE_S3_ENDPOINT must be unset when APP_ENV=prod',
    );
  });
});

describe('the server bindings', () => {
  const AUTH = createEphemeralAuthEnvironment('kd-guard-spec-');
  // Distinct values, so the message check below can look for each of them.
  const SMTP_HOST = 'leak-check-host.invalid';
  const SMTP_PORT = '2577';
  const FROM = 'leak-check-from@example.com';
  const DATABASE_URL = 'postgres://leak_check_user@leak-check-db.invalid:5452/leak_check_db';
  const S3_ENDPOINT = 'http://leak-check-s3.invalid:9020';
  const S3_ACCESS_KEY = 'leak-check-access-key';
  const S3_SECRET_KEY = 'leak-check-secret-key';
  const MEDIA_BUCKET = 'leak-check-media';
  const PRIVATE_BUCKET = 'leak-check-private';
  const PUBLIC_BASE_URL = 'https://leak-check-cdn.invalid';

  /** A `real` storage adapter: no endpoint, no static key; valid in every tier. */
  const env = (appEnv: AppEnv): Environment => ({
    APP_ENV: appEnv,
    DATABASE_URL_APP: DATABASE_URL,
    TRUST_PROXY_HOPS: '1',
    MAIL_ADAPTER: 'smtp',
    MAIL_SMTP_HOST: SMTP_HOST,
    MAIL_SMTP_PORT: SMTP_PORT,
    MAIL_FROM: FROM,
    // Required in `demo` and `prod` (decision 0008 section 10); a fictional origin.
    ADMIN_ORIGINS: 'https://admin.kitchendaylight.example',
    // Required in `demo` and `prod` (decision 0009); fictional names.
    STORAGE_ADAPTER: 's3',
    STORAGE_S3_REGION: 'ap-southeast-1',
    STORAGE_S3_BUCKET_MEDIA: MEDIA_BUCKET,
    STORAGE_S3_BUCKET_PRIVATE: PRIVATE_BUCKET,
    MEDIA_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
    ...AUTH,
  });

  /** The S3 emulator: an endpoint, plus the static keys where the config accepts them. */
  const emulatorEnv = (appEnv: AppEnv): Environment => ({
    ...env(appEnv),
    STORAGE_S3_ENDPOINT: S3_ENDPOINT,
    ...(appEnv === 'dev' || appEnv === 'test'
      ? { STORAGE_S3_ACCESS_KEY: S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY: S3_SECRET_KEY }
      : {}),
  });

  /**
   * A config `loadConfig` refuses (an endpoint in `prod`, keys in `demo` or `prod`), built by hand
   * so the guard's own second check is exercised.
   */
  function withEmulatorSettings(
    config: ServerConfig,
    settings: { readonly endpoint: boolean; readonly keys: boolean },
  ): ServerConfig {
    return {
      ...config,
      storage: {
        ...config.storage,
        s3: {
          ...config.storage.s3,
          endpoint: settings.endpoint ? S3_ENDPOINT : null,
          credentials: settings.keys
            ? { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY }
            : null,
        },
      },
    };
  }

  /** The storage part of the guard's answer. */
  function storageViolations(config: ServerConfig): readonly string[] {
    return productionGuardViolations(config)
      .filter((violation) => 'variable' in violation || violation.port === 'StoragePort')
      .map(describeViolation);
  }

  it('binds MailPort and StoragePort with the kinds of their modules', () => {
    expect(serverPortBindings(loadConfig(emulatorEnv('dev'), 'server'))).toEqual([
      { port: 'MailPort', adapter: 'smtp', kind: 'emulator' },
      { port: 'StoragePort', adapter: 's3', kind: 'emulator' },
    ]);
    expect(serverPortBindings(loadConfig(env('dev'), 'server'))).toEqual([
      { port: 'MailPort', adapter: 'smtp', kind: 'emulator' },
      { port: 'StoragePort', adapter: 's3', kind: 'real' },
    ]);
  });

  it('lists the guarded variables the config carries', () => {
    expect(serverGuardedVariables(loadConfig(emulatorEnv('dev'), 'server'))).toEqual([
      'STORAGE_S3_ENDPOINT',
      'STORAGE_S3_ACCESS_KEY',
      'STORAGE_S3_SECRET_KEY',
    ]);
    expect(serverGuardedVariables(loadConfig(env('prod'), 'server'))).toEqual([]);
  });

  it.each(['dev', 'test', 'demo'] as const)('accepts the smtp adapter in %s', (appEnv) => {
    expect(productionGuardViolations(loadConfig(emulatorEnv(appEnv), 'server'))).toEqual([]);
  });

  it('refuses the smtp adapter in prod with one line naming port, adapter, kind and APP_ENV', () => {
    const violations = productionGuardViolations(loadConfig(env('prod'), 'server'));

    expect(violations.map(describeViolation)).toEqual([
      'MailPort: adapter smtp (emulator) is refused when APP_ENV=prod',
    ]);
  });

  it('refuses the ses adapter in test', () => {
    const config = loadConfig({ ...emulatorEnv('test'), MAIL_ADAPTER: 'ses' }, 'server');

    expect(productionGuardViolations(config).map(describeViolation)).toEqual([
      'MailPort: adapter ses (real) is refused when APP_ENV=test',
    ]);
  });

  // Decision 0009 section 9, tier × storage kind. `prod` with an emulator cannot come out of
  // `loadConfig` (it refuses the endpoint), so that row is built by hand.
  const STORAGE_ROWS: readonly {
    readonly appEnv: AppEnv;
    readonly kind: 'emulator' | 'real';
    readonly expected: readonly string[];
  }[] = [
    { appEnv: 'dev', kind: 'emulator', expected: [] },
    { appEnv: 'dev', kind: 'real', expected: [] },
    { appEnv: 'test', kind: 'emulator', expected: [] },
    {
      appEnv: 'test',
      kind: 'real',
      expected: ['StoragePort: adapter s3 (real) is refused when APP_ENV=test'],
    },
    { appEnv: 'demo', kind: 'emulator', expected: [] },
    { appEnv: 'demo', kind: 'real', expected: [] },
    { appEnv: 'prod', kind: 'real', expected: [] },
  ];

  it.each(STORAGE_ROWS)('storage in $appEnv with the $kind kind', ({ appEnv, kind, expected }) => {
    const config = loadConfig(kind === 'emulator' ? emulatorEnv(appEnv) : env(appEnv), 'server');

    expect(storageViolations(config)).toEqual(expected);
  });

  it('refuses the emulator in prod: the binding and every emulator variable', () => {
    const config = withEmulatorSettings(loadConfig(env('prod'), 'server'), {
      endpoint: true,
      keys: true,
    });

    expect(storageViolations(config)).toEqual([
      'StoragePort: adapter s3 (emulator) is refused when APP_ENV=prod',
      'STORAGE_S3_ENDPOINT must be unset when APP_ENV=prod',
      'STORAGE_S3_ACCESS_KEY must be unset when APP_ENV=prod',
      'STORAGE_S3_SECRET_KEY must be unset when APP_ENV=prod',
    ]);
  });

  it('refuses static keys in demo and prod, even against AWS', () => {
    for (const appEnv of ['demo', 'prod'] as const) {
      const config = withEmulatorSettings(loadConfig(env(appEnv), 'server'), {
        endpoint: false,
        keys: true,
      });

      expect(storageViolations(config)).toEqual([
        `STORAGE_S3_ACCESS_KEY must be unset when APP_ENV=${appEnv}`,
        `STORAGE_S3_SECRET_KEY must be unset when APP_ENV=${appEnv}`,
      ]);
    }
  });

  it('never puts a configuration value into a refusal message', () => {
    const config = withEmulatorSettings(loadConfig(env('prod'), 'server'), {
      endpoint: true,
      keys: true,
    });
    const text = productionGuardViolations(config).map(describeViolation).join('\n');
    const values = [
      SMTP_HOST,
      SMTP_PORT,
      FROM,
      DATABASE_URL,
      S3_ENDPOINT,
      S3_ACCESS_KEY,
      S3_SECRET_KEY,
      MEDIA_BUCKET,
      PRIVATE_BUCKET,
      PUBLIC_BASE_URL,
      'leak',
      ...Object.values(AUTH),
    ];

    expect(text).not.toBe('');
    for (const value of values) {
      expect(text).not.toContain(value);
    }
  });
});
