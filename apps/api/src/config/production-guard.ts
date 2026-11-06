import { MAIL_ADAPTER_KINDS } from '../modules/mail/mail-adapter.factory.js';
import type { AdapterKind } from './adapter-kind.js';
import type { AppEnv } from './config.schema.js';
import type { ServerConfig } from './load-config.js';

// Decision 0005, section 5 (ADR-0004, "Production safety guard"). Runs in `main.ts` after
// `loadConfig` and before `NestFactory.create`. The S3 endpoint and key rules arrive with A6-T2.

/** One port bound to one adapter, as the owning module's kind table declares it. */
export interface PortBinding {
  readonly port: string;
  readonly adapter: string;
  readonly kind: AdapterKind;
}

export interface ProductionGuardInput {
  readonly appEnv: AppEnv;
  readonly bindings: readonly PortBinding[];
}

/** Names the port, the adapter, its kind and `APP_ENV`, and nothing else. */
export interface ProductionGuardViolation extends PortBinding {
  readonly appEnv: AppEnv;
}

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

/** Pure: the bindings that `appEnv` refuses, in input order. */
export function evaluateProductionGuard({
  appEnv,
  bindings,
}: ProductionGuardInput): readonly ProductionGuardViolation[] {
  return bindings
    .filter(({ kind }) => REFUSED_KINDS[appEnv].includes(kind))
    .map(({ port, adapter, kind }) => Object.freeze({ port, adapter, kind, appEnv }));
}

/** One stderr line per violation. */
export function describeViolation({
  port,
  adapter,
  kind,
  appEnv,
}: ProductionGuardViolation): string {
  return `${port}: adapter ${adapter} (${kind}) is refused when APP_ENV=${appEnv}`;
}

/** The ports the server binds, each with the kind its module's table declares. */
export function serverPortBindings(config: ServerConfig): readonly PortBinding[] {
  return [
    {
      port: 'MailPort',
      adapter: config.mail.adapter,
      kind: MAIL_ADAPTER_KINDS[config.mail.adapter],
    },
  ];
}

/** The guard over the server's own bindings. */
export function productionGuardViolations(
  config: ServerConfig,
): readonly ProductionGuardViolation[] {
  return evaluateProductionGuard({ appEnv: config.appEnv, bindings: serverPortBindings(config) });
}
