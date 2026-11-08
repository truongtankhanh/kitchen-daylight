import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CliEnvironment,
  DEFAULT_ADMIN_ORIGINS,
  DEFAULT_LOG_LEVEL,
  DEFAULT_MAIL_FROM,
  DEFAULT_PORT,
  DEFAULT_TRUST_PROXY_HOPS,
  effectiveMailAdapter,
  ServerEnvironment,
} from './config.schema.js';
import type { AppEnv, LogLevel, TrustProxyHops } from './config.schema.js';

export type ConfigKind = 'server' | 'cli';

export type Environment = Readonly<Record<string, string | undefined>>;

export interface CliConfig {
  readonly appEnv: AppEnv;
  readonly database: { readonly url: string };
}

/**
 * Auth settings as plain strings (decision 0008, section 12). The token and MFA services import
 * the key objects at start-up (A1-T6), never at import time.
 */
export interface AuthConfig {
  readonly jwt: {
    /** Base64 of the PKCS#8 PEM. */
    readonly privateKey: string;
    /** Base64 of the SPKI PEM. */
    readonly publicKey: string;
    readonly keyId: string;
    /** Accepted for verification only, until the access-token TTL has passed. */
    readonly previousPublicKeys: readonly { readonly keyId: string; readonly publicKey: string }[];
  };
  /** Base64, at least 32 bytes. */
  readonly otpHmacSecret: string;
  readonly mfaEncryption: {
    /** Base64, 32 bytes. */
    readonly key: string;
    /** Decrypt only. */
    readonly previousKeys: readonly string[];
  };
  /**
   * Social sign-in `aud` allow-lists (A2-T6; decision 0008 section 11). An empty list disables the
   * provider: its routes answer `NOT_FOUND` and verify nothing.
   */
  readonly social: {
    readonly googleClientIds: readonly string[];
    readonly appleClientIds: readonly string[];
  };
}

/**
 * Mail settings (decision 0005, section 2). `smtp` carries the Mailpit address; `MAIL_UI_URL` is
 * never read by the API.
 */
export type MailConfig =
  | {
      readonly adapter: 'smtp';
      readonly from: string;
      readonly smtp: { readonly host: string; readonly port: number };
    }
  | { readonly adapter: 'ses'; readonly from: string };

export interface ServerConfig extends CliConfig {
  readonly port: number;
  readonly logLevel: LogLevel;
  /** Express `trust proxy`, applied in `main.ts` (decision 0007 section 5). */
  readonly trustProxyHops: TrustProxyHops;
  readonly auth: AuthConfig;
  readonly mail: MailConfig;
  /**
   * The exact `Origin` values allowed on `POST /admin/auth/*` (decision 0008 section 10; A3-T1):
   * `ADMIN_ORIGINS`, else `DEFAULT_ADMIN_ORIGINS` in `dev` and `test`. The first entry is the base of
   * staff links (A3-T3).
   */
  readonly adminOrigins: readonly string[];
  /** `APP_STORE_URL_IOS`, `APP_STORE_URL_ANDROID`; `null` when unset (A4-T3). */
  readonly appStoreUrls: AppStoreUrls;
}

/** The store page of each mobile platform, for `UPGRADE_REQUIRED` (brief L12). */
export interface AppStoreUrls {
  readonly ios: string | null;
  readonly android: string | null;
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

// Decision 0008, section 12. The CLI reads none of them.
const AUTH_VARIABLES = [
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_KEY_ID',
  'JWT_PREVIOUS_PUBLIC_KEYS',
  'OTP_HMAC_SECRET',
  'MFA_ENCRYPTION_KEY',
  'MFA_ENCRYPTION_PREVIOUS_KEYS',
  'GOOGLE_CLIENT_IDS',
  'APPLE_CLIENT_IDS',
] as const;

// Decision 0005, section 2 (A1-T8). `MAIL_UI_URL` is for people and e2e tests, never read here.
const MAIL_VARIABLES = ['MAIL_ADAPTER', 'MAIL_SMTP_HOST', 'MAIL_SMTP_PORT', 'MAIL_FROM'] as const;

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
    raw['TRUST_PROXY_HOPS'] = read(env, 'TRUST_PROXY_HOPS');
    raw['ADMIN_ORIGINS'] = read(env, 'ADMIN_ORIGINS');
    raw['APP_STORE_URL_IOS'] = read(env, 'APP_STORE_URL_IOS');
    raw['APP_STORE_URL_ANDROID'] = read(env, 'APP_STORE_URL_ANDROID');
    for (const name of [...AUTH_VARIABLES, ...MAIL_VARIABLES]) {
      raw[name] = read(env, name);
    }
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
      trustProxyHops: instance.TRUST_PROXY_HOPS ?? DEFAULT_TRUST_PROXY_HOPS,
      auth: toAuthConfig(instance),
      mail: toMailConfig(instance),
      adminOrigins: Object.freeze(instance.ADMIN_ORIGINS?.split(',') ?? [...DEFAULT_ADMIN_ORIGINS]),
      appStoreUrls: Object.freeze({
        ios: instance.APP_STORE_URL_IOS ?? null,
        android: instance.APP_STORE_URL_ANDROID ?? null,
      }),
    });
  }
  return Object.freeze({ appEnv: instance.APP_ENV, database });
}

/** Splits the validated lists; `undefined` gives an empty list. */
function toAuthConfig(env: ServerEnvironment): AuthConfig {
  const previousPublicKeys = (env.JWT_PREVIOUS_PUBLIC_KEYS?.split(',') ?? []).map((entry) => {
    const separator = entry.indexOf(':');
    return Object.freeze({
      keyId: entry.slice(0, separator),
      publicKey: entry.slice(separator + 1),
    });
  });
  return Object.freeze({
    jwt: Object.freeze({
      privateKey: env.JWT_PRIVATE_KEY,
      publicKey: env.JWT_PUBLIC_KEY,
      keyId: env.JWT_KEY_ID,
      previousPublicKeys: Object.freeze(previousPublicKeys),
    }),
    otpHmacSecret: env.OTP_HMAC_SECRET,
    mfaEncryption: Object.freeze({
      key: env.MFA_ENCRYPTION_KEY,
      previousKeys: Object.freeze(env.MFA_ENCRYPTION_PREVIOUS_KEYS?.split(',') ?? []),
    }),
    social: Object.freeze({
      googleClientIds: Object.freeze(env.GOOGLE_CLIENT_IDS?.split(',') ?? []),
      appleClientIds: Object.freeze(env.APPLE_CLIENT_IDS?.split(',') ?? []),
    }),
  });
}

/** Applies the `dev`/`test` defaults; the validation above guarantees every value read here. */
function toMailConfig(env: ServerEnvironment): MailConfig {
  const from = env.MAIL_FROM ?? DEFAULT_MAIL_FROM;
  if (effectiveMailAdapter(env) === 'ses') {
    return Object.freeze({ adapter: 'ses', from });
  }
  return Object.freeze({
    adapter: 'smtp',
    from,
    smtp: Object.freeze({ host: env.MAIL_SMTP_HOST as string, port: env.MAIL_SMTP_PORT as number }),
  });
}

function firstRule(constraints: Record<string, string> | undefined): string {
  return Object.values(constraints ?? {})[0] ?? 'invalid';
}
