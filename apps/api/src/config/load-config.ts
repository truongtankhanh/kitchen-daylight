import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CliEnvironment,
  DEFAULT_LOG_LEVEL,
  DEFAULT_PORT,
  ServerEnvironment,
} from './config.schema.js';
import type { AppEnv, LogLevel } from './config.schema.js';

export type ConfigKind = 'server' | 'cli';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface CliConfig {
  readonly appEnv: AppEnv;
  readonly database: { readonly url: string };
}

export interface ServerConfig extends CliConfig {
  readonly port: number;
  readonly logLevel: LogLevel;
}

export interface ConfigIssue {
  /** Variable name(s), never a value. */
  readonly name: string;
  readonly rule: string;
}

/** Thrown when the environment is invalid. The message holds names and rules only. */
export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(issues.map(({ name, rule }) => `${name}: ${rule}`).join('\n'));
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

// Decision 0005, section 2: the container name first, then the host-side name of the process.
const CONTAINER_DATABASE_URL = 'DATABASE_URL';
const HOST_DATABASE_URL: Record<ConfigKind, string> = {
  server: 'DATABASE_URL_APP',
  cli: 'DATABASE_URL_MIGRATOR',
};

/** An empty value counts as unset. */
function read(env: Environment, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Maps and validates the environment of one process (decision 0005, section 4).
 * Pure: reads only `env`, returns a frozen object, throws `ConfigValidationError`.
 */
export function loadConfig(env: Environment, kind: 'server'): ServerConfig;
export function loadConfig(env: Environment, kind: 'cli'): CliConfig;
export function loadConfig(env: Environment, kind: ConfigKind): CliConfig | ServerConfig;
export function loadConfig(env: Environment, kind: ConfigKind): CliConfig | ServerConfig {
  const issues: ConfigIssue[] = [];

  const hostName = HOST_DATABASE_URL[kind];
  const present = [CONTAINER_DATABASE_URL, hostName].filter(
    (name) => read(env, name) !== undefined,
  );
  const ambiguous = present.length > 1;
  if (ambiguous) {
    issues.push({ name: present.join(', '), rule: 'ambiguous, set only one' });
  }
  const databaseUrlName = present.length === 1 ? (present[0] as string) : hostName;

  const raw: Record<string, string | undefined> = {
    APP_ENV: read(env, 'APP_ENV'),
    databaseUrl: ambiguous ? undefined : read(env, databaseUrlName),
  };
  if (kind === 'server') {
    raw['PORT'] = read(env, 'PORT');
    raw['LOG_LEVEL'] = read(env, 'LOG_LEVEL');
  }

  const schema = kind === 'server' ? ServerEnvironment : CliEnvironment;
  const instance = plainToInstance(schema, raw, { enableImplicitConversion: true });
  const errors = validateSync(instance, { skipMissingProperties: false, stopAtFirstError: true });

  for (const error of errors) {
    if (error.property === 'databaseUrl') {
      if (ambiguous) {
        continue;
      }
      issues.push({
        name: databaseUrlName,
        rule:
          raw['databaseUrl'] === undefined
            ? `required (${CONTAINER_DATABASE_URL} in a container)`
            : firstRule(error.constraints),
      });
      continue;
    }
    issues.push({
      name: error.property,
      rule: raw[error.property] === undefined ? 'required' : firstRule(error.constraints),
    });
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  const database = Object.freeze({ url: instance.databaseUrl });
  if (instance instanceof ServerEnvironment) {
    return Object.freeze({
      appEnv: instance.APP_ENV,
      database,
      port: instance.PORT ?? DEFAULT_PORT,
      logLevel: instance.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    });
  }
  return Object.freeze({ appEnv: instance.APP_ENV, database });
}

function firstRule(constraints: Record<string, string> | undefined): string {
  return Object.values(constraints ?? {})[0] ?? 'invalid';
}
