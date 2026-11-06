import { describe, expect, it } from 'vitest';

import { ADAPTER_KINDS } from './adapter-kind.js';
import type { AdapterKind } from './adapter-kind.js';
import { APP_ENVS } from './config.schema.js';
import type { AppEnv } from './config.schema.js';
import { createEphemeralAuthEnvironment } from './ephemeral-auth-environment.js';
import { loadConfig } from './load-config.js';
import type { Environment } from './load-config.js';
import {
  describeViolation,
  evaluateProductionGuard,
  productionGuardViolations,
  serverPortBindings,
} from './production-guard.js';

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

describe('evaluateProductionGuard (per tier)', () => {
  it('covers three kinds in four tiers', () => {
    expect(CELLS).toHaveLength(12);
    expect(CELLS.filter(({ refused }) => refused)).toHaveLength(3);
  });

  // No `real` mail adapter exists before A12-T4: every cell uses a synthetic binding of that kind.
  it.each(CELLS)('$appEnv with a $kind binding: refused=$refused', ({ appEnv, kind, refused }) => {
    const binding = { port: 'MailPort', adapter: `synthetic-${kind}`, kind };

    const violations = evaluateProductionGuard({ appEnv, bindings: [binding] });

    expect(violations).toEqual(refused ? [{ ...binding, appEnv }] : []);
  });

  it('reports each refused binding and keeps the accepted ones out', () => {
    const bindings = [
      { port: 'MailPort', adapter: 'smtp', kind: 'emulator' as const },
      { port: 'StoragePort', adapter: 'synthetic-real', kind: 'real' as const },
      { port: 'GeocodePort', adapter: 'synthetic-fixture', kind: 'fixture' as const },
    ];

    expect(evaluateProductionGuard({ appEnv: 'prod', bindings }).map(({ port }) => port)).toEqual([
      'MailPort',
      'GeocodePort',
    ]);
  });

  it('accepts an empty binding list in every tier', () => {
    for (const appEnv of APP_ENVS) {
      expect(evaluateProductionGuard({ appEnv, bindings: [] })).toEqual([]);
    }
  });
});

describe('the server bindings', () => {
  const AUTH = createEphemeralAuthEnvironment('kd-guard-spec-');
  // Distinct values, so the message check below can look for each of them.
  const SMTP_HOST = 'leak-check-host.invalid';
  const SMTP_PORT = '2577';
  const FROM = 'leak-check-from@example.com';
  const DATABASE_URL = 'postgres://leak_check_user@leak-check-db.invalid:5452/leak_check_db';

  const env = (appEnv: AppEnv): Environment => ({
    APP_ENV: appEnv,
    DATABASE_URL_APP: DATABASE_URL,
    TRUST_PROXY_HOPS: '1',
    MAIL_ADAPTER: 'smtp',
    MAIL_SMTP_HOST: SMTP_HOST,
    MAIL_SMTP_PORT: SMTP_PORT,
    MAIL_FROM: FROM,
    ...AUTH,
  });

  it('binds MailPort with the kind of the mail kind table', () => {
    expect(serverPortBindings(loadConfig(env('dev'), 'server'))).toEqual([
      { port: 'MailPort', adapter: 'smtp', kind: 'emulator' },
    ]);
  });

  it.each(['dev', 'test', 'demo'] as const)('accepts the smtp adapter in %s', (appEnv) => {
    expect(productionGuardViolations(loadConfig(env(appEnv), 'server'))).toEqual([]);
  });

  it('refuses the smtp adapter in prod with one line naming port, adapter, kind and APP_ENV', () => {
    const violations = productionGuardViolations(loadConfig(env('prod'), 'server'));

    expect(violations.map(describeViolation)).toEqual([
      'MailPort: adapter smtp (emulator) is refused when APP_ENV=prod',
    ]);
  });

  it('refuses the ses adapter in test', () => {
    const config = loadConfig({ ...env('test'), MAIL_ADAPTER: 'ses' }, 'server');

    expect(productionGuardViolations(config).map(describeViolation)).toEqual([
      'MailPort: adapter ses (real) is refused when APP_ENV=test',
    ]);
  });

  it('never puts a configuration value into a refusal message', () => {
    const text = productionGuardViolations(loadConfig(env('prod'), 'server'))
      .map(describeViolation)
      .join('\n');
    const values = [SMTP_HOST, SMTP_PORT, FROM, DATABASE_URL, 'leak', ...Object.values(AUTH)];

    expect(text).not.toBe('');
    for (const value of values) {
      expect(text).not.toContain(value);
    }
  });
});
