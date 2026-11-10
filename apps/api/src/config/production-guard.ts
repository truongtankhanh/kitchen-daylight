import { MAIL_ADAPTER_KINDS } from '../modules/mail/mail-adapter.factory.js';
import { storageAdapterKind } from '../modules/media/adapters/s3/build-s3-client-options.js';
import type { AdapterKind } from './adapter-kind.js';
import type { AppEnv } from './config.schema.js';
import type { ServerConfig } from './load-config.js';

// Decision 0005, section 5 (ADR-0004, "Production safety guard"), with the storage rows of decision
// 0009 section 9 (A6-T2). Runs in `main.ts` after `loadConfig` and before `NestFactory.create`.

/** One port bound to one adapter, as the owning module's kind table declares it. */
export interface PortBinding {
  readonly port: string;
  readonly adapter: string;
  readonly kind: AdapterKind;
}

/** The guarded variables of decision 0005 section 5: emulator-only settings. */
export const GUARDED_VARIABLES = [
  'STORAGE_S3_ENDPOINT',
  'STORAGE_S3_ACCESS_KEY',
  'STORAGE_S3_SECRET_KEY',
] as const;
export type GuardedVariable = (typeof GUARDED_VARIABLES)[number];

export interface ProductionGuardInput {
  readonly appEnv: AppEnv;
  readonly bindings: readonly PortBinding[];
  /** The guarded variables that are set; none when omitted. */
  readonly setVariables?: readonly GuardedVariable[];
}

/** A refused binding: names the port, the adapter, its kind and `APP_ENV`, and nothing else. */
export interface BindingViolation extends PortBinding {
  readonly appEnv: AppEnv;
}

/** A guarded variable that is set where it is refused: its name and `APP_ENV`, never its value. */
export interface VariableViolation {
  readonly variable: GuardedVariable;
  readonly appEnv: AppEnv;
}

export type ProductionGuardViolation = BindingViolation | VariableViolation;

/**
 * The kinds each tier refuses: `prod` never runs on an emulator or a fixture, and `test` never
 * reaches a real provider (Docker repository M4).
 */
export const REFUSED_KINDS: Readonly<Record<AppEnv, readonly AdapterKind[]>> = Object.freeze({
  dev: [],
  test: ['real'],
  demo: [],
  prod: ['emulator', 'fixture'],
});

/**
 * The guarded variables each tier refuses (decision 0005 sections 2 and 5): `prod` takes no
 * endpoint override and no static key; `demo` takes no static key (instance profile).
 */
export const REFUSED_VARIABLES: Readonly<Record<AppEnv, readonly GuardedVariable[]>> =
  Object.freeze({
    dev: [],
    test: [],
    demo: ['STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY'],
    prod: ['STORAGE_S3_ENDPOINT', 'STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY'],
  });

/** Pure: the bindings, then the variables, that `appEnv` refuses, each in input order. */
export function evaluateProductionGuard({
  appEnv,
  bindings,
  setVariables = [],
}: ProductionGuardInput): readonly ProductionGuardViolation[] {
  const refusedBindings = bindings
    .filter(({ kind }) => REFUSED_KINDS[appEnv].includes(kind))
    .map(({ port, adapter, kind }) => Object.freeze({ port, adapter, kind, appEnv }));
  const refusedVariables = setVariables
    .filter((variable) => REFUSED_VARIABLES[appEnv].includes(variable))
    .map((variable) => Object.freeze({ variable, appEnv }));
  return [...refusedBindings, ...refusedVariables];
}

/** One stderr line per violation. */
export function describeViolation(violation: ProductionGuardViolation): string {
  if ('variable' in violation) {
    return `${violation.variable} must be unset when APP_ENV=${violation.appEnv}`;
  }
  const { port, adapter, kind, appEnv } = violation;
  return `${port}: adapter ${adapter} (${kind}) is refused when APP_ENV=${appEnv}`;
}

/** The ports the server binds, each with the kind its module declares. */
export function serverPortBindings(config: ServerConfig): readonly PortBinding[] {
  return [
    {
      port: 'MailPort',
      adapter: config.mail.adapter,
      kind: MAIL_ADAPTER_KINDS[config.mail.adapter],
    },
    {
      port: 'StoragePort',
      adapter: config.storage.adapter,
      kind: storageAdapterKind(config.storage.s3),
    },
  ];
}

/** The guarded variables present in the server config (a static key counts as both names). */
export function serverGuardedVariables(config: ServerConfig): readonly GuardedVariable[] {
  const { endpoint, credentials } = config.storage.s3;
  return [
    ...(endpoint === null ? [] : (['STORAGE_S3_ENDPOINT'] as const)),
    ...(credentials === null ? [] : (['STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY'] as const)),
  ];
}

/**
 * The guard over the server's own bindings and variables. `loadConfig` already refuses the guarded
 * variables in `demo` and `prod`; the guard checks them again, so a config built another way (or a
 * future change of the schema) cannot boot `prod` against an emulator.
 */
export function productionGuardViolations(
  config: ServerConfig,
): readonly ProductionGuardViolation[] {
  return evaluateProductionGuard({
    appEnv: config.appEnv,
    bindings: serverPortBindings(config),
    setVariables: serverGuardedVariables(config),
  });
}
