// class-transformer decorators read Reflect metadata when the class is defined. Load the
// polyfill here, not through Nest, because the CLI and the specs call loadConfig without Nest.
import 'reflect-metadata';

import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
} from 'class-validator';
import type { ValidationArguments } from 'class-validator';

// Decision 0005, sections 2, 4 and 5, and decision 0008, section 12 (auth). The auth variables are
// validated before the token service (A1-T6) reads them, so every tier fails fast on a bad secret.

export const APP_ENVS = ['dev', 'test', 'demo', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_PORT = 3000;
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** The local placeholder prefix (decision 0002, section 5); never a real password. */
export const PLACEHOLDER_PASSWORD_PREFIX = 'CHANGE_ME_LOCAL';
const PLACEHOLDER_ALLOWED_IN: readonly AppEnv[] = ['dev', 'test'];

const PORT_RULE = 'must be an integer from 1 to 65535';

/**
 * Express `trust proxy` hop count (decision 0007 section 5): 0 (no proxy, the Express default) or
 * 1 (Caddy, the only hop of the Docker `apps` profile, `demo` and `prod`). A higher value would let
 * a client choose its own address with a forged `X-Forwarded-For`, so it is refused.
 */
export const TRUST_PROXY_HOPS_VALUES = [0, 1] as const;
export type TrustProxyHops = (typeof TRUST_PROXY_HOPS_VALUES)[number];
export const DEFAULT_TRUST_PROXY_HOPS: TrustProxyHops = 0;
/** Required where a tier must never start with a silent default, like the `*_ADAPTER` variables. */
const TRUST_PROXY_HOPS_REQUIRED_IN: readonly AppEnv[] = ['demo', 'prod'];
const TRUST_PROXY_HOPS_RULE = 'must be 0 or 1';

// --- Mail variables (decision 0005, section 2; A1-T8) ------------------------------------------

/** `smtp`: Mailpit in `dev` and `test` (kind `emulator`). `ses`: arrives in A12-T4 (kind `real`). */
export const MAIL_ADAPTERS = ['smtp', 'ses'] as const;
export type MailAdapterName = (typeof MAIL_ADAPTERS)[number];
/** Applies only in `dev` and `test` and only when `MAIL_ADAPTER` is unset. */
export const DEFAULT_MAIL_ADAPTER: MailAdapterName = 'smtp';
/** Fictional sender of `dev` and `test`; `demo` and `prod` set their own. */
export const DEFAULT_MAIL_FROM = 'no-reply@kitchendaylight.example';
/** `demo` and `prod` accept only adapters and senders named explicitly (decision 0005, section 5). */
const MAIL_REQUIRED_IN: readonly AppEnv[] = ['demo', 'prod'];
const MAIL_DEFAULTS_IN: readonly AppEnv[] = ['dev', 'test'];
const MAIL_SMTP_HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const MAIL_SMTP_HOST_RULE = 'must be a host name or an IPv4 address';

// --- Admin web origins (decision 0008 section 10; A3-T1) ---------------------------------------

/**
 * The `ng serve` origin, used in `dev` and `test` when `ADMIN_ORIGINS` is unset (api-divergences
 * D-077). The Caddy origin of the Docker `apps` profile is added through the variable.
 */
export const DEFAULT_ADMIN_ORIGINS: readonly string[] = Object.freeze(['http://localhost:4200']);
/** `demo` and `prod` name their origins explicitly, and only `https` ones. */
const ADMIN_ORIGINS_REQUIRED_IN: readonly AppEnv[] = ['demo', 'prod'];
export const ADMIN_ORIGINS_RULE =
  'must be a comma-separated list of unique origins (scheme://host[:port], no path), https only when APP_ENV is demo or prod';

/**
 * True when every entry is an exact, canonical `http(s)` origin as a browser sends it in `Origin`:
 * no path, no trailing slash, no default port, lower-case scheme and host, no wildcard.
 */
export function isAdminOriginList(value: unknown, appEnv: unknown): boolean {
  if (typeof value !== 'string' || value === '') {
    return false;
  }
  const httpsOnly = ADMIN_ORIGINS_REQUIRED_IN.some((tier) => tier === appEnv);
  const entries = value.split(',');
  if (new Set(entries).size !== entries.length) {
    return false;
  }
  return entries.every((entry) => {
    if (!URL.canParse(entry)) {
      return false;
    }
    const url = new URL(entry);
    const scheme = url.protocol;
    if (scheme !== 'https:' && (httpsOnly || scheme !== 'http:')) {
      return false;
    }
    // WHATWG URL accepts `*` in a host, so `https://*.example` is its own origin: check the host.
    return url.origin === entry && MAIL_SMTP_HOST_PATTERN.test(url.hostname);
  });
}

function AdminOriginList(): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'adminOriginList',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: ADMIN_ORIGINS_RULE },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          return isAdminOriginList(value, (args.object as Partial<ServerEnvironment>).APP_ENV);
        },
      },
    });
  };
}

/** The adapter the mail slice will use: the explicit one, else the `dev`/`test` default. */
export function effectiveMailAdapter(
  env: Pick<ServerEnvironment, 'APP_ENV' | 'MAIL_ADAPTER'>,
): MailAdapterName | undefined {
  if (env.MAIL_ADAPTER !== undefined) {
    return env.MAIL_ADAPTER;
  }
  return MAIL_DEFAULTS_IN.includes(env.APP_ENV) ? DEFAULT_MAIL_ADAPTER : undefined;
}

/** Validated when set, and always in `demo` and `prod`. */
function presentOrRequiredInDeployedTiers(property: 'MAIL_ADAPTER' | 'MAIL_FROM') {
  return (env: ServerEnvironment): boolean =>
    env[property] !== undefined || MAIL_REQUIRED_IN.includes(env.APP_ENV);
}

/** The SMTP variables are read only when the adapter is `smtp` (decision 0005, section 2). */
function usesSmtp(env: ServerEnvironment): boolean {
  return effectiveMailAdapter(env) === 'smtp';
}

function hasPlaceholderPassword(value: unknown): boolean {
  if (typeof value !== 'string' || !URL.canParse(value)) {
    return false;
  }
  return decodeURIComponent(new URL(value).password).includes(PLACEHOLDER_PASSWORD_PREFIX);
}

/** Rejects the placeholder password unless `APP_ENV` is `dev` or `test`. */
function NoPlaceholderPasswordOutsideLocal(): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'noPlaceholderPasswordOutsideLocal',
      target: target.constructor,
      propertyName: String(propertyName),
      options: { message: 'must not embed the placeholder password when APP_ENV is demo or prod' },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const appEnv = (args.object as Partial<CliEnvironment>).APP_ENV;
          if (appEnv !== undefined && PLACEHOLDER_ALLOWED_IN.includes(appEnv)) {
            return true;
          }
          return !hasPlaceholderPassword(value);
        },
      },
    });
  };
}

/**
 * Variables read by the CLI. Property names are the variable names, except `databaseUrl`,
 * which holds whichever database URL variable applies to the process (`loadConfig`).
 * Messages never interpolate the value.
 */
export class CliEnvironment {
  @IsIn(APP_ENVS, { message: `must be one of ${APP_ENVS.join('|')}` })
  APP_ENV!: AppEnv;

  @IsUrl(
    { protocols: ['postgres', 'postgresql'], require_protocol: true, require_tld: false },
    { message: 'must be a postgres:// or postgresql:// URL' },
  )
  @NoPlaceholderPasswordOutsideLocal()
  databaseUrl!: string;
}

// --- Auth variables (decision 0008, section 12) ---------------------------------------------
// Each check returns the broken rule or `undefined`. A check parses keys with `node:crypto` when
// `loadConfig` runs, never at import time, and never puts a value into a rule.

export const JWT_CURVE = 'prime256v1';
export const JWT_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const MIN_SECRET_BYTES = 32;
export const ENCRYPTION_KEY_BYTES = 32;

export const AUTH_RULES = {
  placeholder: 'must not contain the placeholder when APP_ENV is demo or prod',
  privateKey: 'must be the base64, on one line, of a PKCS#8 PEM private key',
  publicKey: 'must be the base64, on one line, of an SPKI PEM public key',
  curve: `must be an EC key on curve ${JWT_CURVE} (P-256)`,
  keyPair: 'must be the public key of JWT_PRIVATE_KEY',
  keyId: `must match ${JWT_KEY_ID_PATTERN.source}`,
  secret: `must be base64 of at least ${MIN_SECRET_BYTES} bytes`,
  encryptionKey: `must be base64 of exactly ${ENCRYPTION_KEY_BYTES} bytes`,
  previousPublicKeys:
    'must be a comma-separated list of <kid>:<base64 of an SPKI PEM P-256 public key>, each kid unique and different from JWT_KEY_ID',
  previousEncryptionKeys: `must be a comma-separated list of base64 keys of exactly ${ENCRYPTION_KEY_BYTES} bytes, each different from MFA_ENCRYPTION_KEY`,
  socialClientIds:
    'must be a comma-separated list of client ids (letters, digits, ".", "_", "-"; at most 255 characters each), each unique',
} as const;

/**
 * One Google or Apple client id: a Google OAuth client id (`<number>-<id>.apps.googleusercontent.com`)
 * or an Apple bundle id or Services ID (`com.example.kitchendaylight`). Not a secret (A2-T6).
 */
export const SOCIAL_CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

type EnvironmentObject = Readonly<Record<string, unknown>>;
type AuthCheck = (value: string, env: EnvironmentObject) => string | undefined;

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PKCS8_PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
const SPKI_PEM_HEADER = '-----BEGIN PUBLIC KEY-----';

/** Strict, canonical base64 on one line; `undefined` otherwise. */
function decodeBase64(value: string): Buffer | undefined {
  if (value.length === 0 || !BASE64.test(value)) {
    return undefined;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : undefined;
}

type ParsedKey = { readonly key: KeyObject } | { readonly rule: string };

function parseP256Key(value: string, kind: 'private' | 'public'): ParsedKey {
  const formatRule = kind === 'private' ? AUTH_RULES.privateKey : AUTH_RULES.publicKey;
  const pem = decodeBase64(value)?.toString('utf8');
  if (pem?.startsWith(kind === 'private' ? PKCS8_PEM_HEADER : SPKI_PEM_HEADER) !== true) {
    return { rule: formatRule };
  }
  let key: KeyObject;
  try {
    key =
      kind === 'private'
        ? createPrivateKey({ key: pem, format: 'pem' })
        : createPublicKey({ key: pem, format: 'pem' });
  } catch {
    return { rule: formatRule };
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== JWT_CURVE) {
    return { rule: AUTH_RULES.curve };
  }
  return { key };
}

function spkiDer(key: KeyObject): Buffer {
  return key.export({ type: 'spki', format: 'der' });
}

const checkPrivateKey: AuthCheck = (value) => {
  const parsed = parseP256Key(value, 'private');
  return 'rule' in parsed ? parsed.rule : undefined;
};

const checkPublicKey: AuthCheck = (value, env) => {
  const parsed = parseP256Key(value, 'public');
  if ('rule' in parsed) {
    return parsed.rule;
  }
  const privateValue = env['JWT_PRIVATE_KEY'];
  if (typeof privateValue !== 'string') {
    return undefined;
  }
  // A broken private key is reported on JWT_PRIVATE_KEY only.
  const privateKey = parseP256Key(privateValue, 'private');
  if ('rule' in privateKey) {
    return undefined;
  }
  return spkiDer(createPublicKey(privateKey.key)).equals(spkiDer(parsed.key))
    ? undefined
    : AUTH_RULES.keyPair;
};

const checkKeyId: AuthCheck = (value) =>
  JWT_KEY_ID_PATTERN.test(value) ? undefined : AUTH_RULES.keyId;

const checkSecret: AuthCheck = (value) =>
  (decodeBase64(value)?.length ?? 0) >= MIN_SECRET_BYTES ? undefined : AUTH_RULES.secret;

const checkEncryptionKey: AuthCheck = (value) =>
  decodeBase64(value)?.length === ENCRYPTION_KEY_BYTES ? undefined : AUTH_RULES.encryptionKey;

const checkPreviousPublicKeys: AuthCheck = (value, env) => {
  const keyIds = new Set<unknown>([env['JWT_KEY_ID']]);
  for (const entry of value.split(',')) {
    const separator = entry.indexOf(':');
    const keyId = entry.slice(0, separator);
    if (separator < 0 || !JWT_KEY_ID_PATTERN.test(keyId) || keyIds.has(keyId)) {
      return AUTH_RULES.previousPublicKeys;
    }
    keyIds.add(keyId);
    if ('rule' in parseP256Key(entry.slice(separator + 1), 'public')) {
      return AUTH_RULES.previousPublicKeys;
    }
  }
  return undefined;
};

const checkPreviousEncryptionKeys: AuthCheck = (value, env) => {
  const keys = new Set<unknown>([env['MFA_ENCRYPTION_KEY']]);
  for (const entry of value.split(',')) {
    if (keys.has(entry) || decodeBase64(entry)?.length !== ENCRYPTION_KEY_BYTES) {
      return AUTH_RULES.previousEncryptionKeys;
    }
    keys.add(entry);
  }
  return undefined;
};

const checkSocialClientIds: AuthCheck = (value) => {
  const ids = value.split(',');
  return ids.every((id) => SOCIAL_CLIENT_ID_PATTERN.test(id)) && new Set(ids).size === ids.length
    ? undefined
    : AUTH_RULES.socialClientIds;
};

/** The rule an auth value breaks, the placeholder rule first; `required` when absent. */
function brokenAuthRule(
  check: AuthCheck,
  value: unknown,
  env: EnvironmentObject,
): string | undefined {
  if (typeof value !== 'string') {
    return 'required';
  }
  const appEnv = env['APP_ENV'];
  const placeholderAllowed = PLACEHOLDER_ALLOWED_IN.some((allowed) => allowed === appEnv);
  if (!placeholderAllowed && value.includes(PLACEHOLDER_PASSWORD_PREFIX)) {
    return AUTH_RULES.placeholder;
  }
  return check(value, env);
}

/** One decorator per auth variable: its message is the first rule the value breaks. */
function AuthValue(check: AuthCheck): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'authValue',
      target: target.constructor,
      propertyName: String(propertyName),
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          return brokenAuthRule(check, value, args.object as EnvironmentObject) === undefined;
        },
        defaultMessage(args: ValidationArguments): string {
          return brokenAuthRule(check, args.value, args.object as EnvironmentObject) ?? 'invalid';
        },
      },
    });
  };
}

/** Variables read by the server. */
export class ServerEnvironment extends CliEnvironment {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: PORT_RULE })
  @Min(1, { message: PORT_RULE })
  @Max(65535, { message: PORT_RULE })
  PORT?: number;

  @IsOptional()
  @IsIn(LOG_LEVELS, { message: `must be one of ${LOG_LEVELS.join('|')}` })
  LOG_LEVEL?: LogLevel;

  // Optional in `dev` and `test` (default 0), required in `demo` and `prod`.
  @ValidateIf(
    (env: ServerEnvironment) =>
      env.TRUST_PROXY_HOPS !== undefined || TRUST_PROXY_HOPS_REQUIRED_IN.includes(env.APP_ENV),
  )
  @Type(() => Number)
  @IsInt({ message: TRUST_PROXY_HOPS_RULE })
  @IsIn(TRUST_PROXY_HOPS_VALUES, { message: TRUST_PROXY_HOPS_RULE })
  TRUST_PROXY_HOPS?: TrustProxyHops;

  // `dev` and `test`: default `smtp`; `demo` and `prod`: required.
  @ValidateIf(presentOrRequiredInDeployedTiers('MAIL_ADAPTER'))
  @IsIn(MAIL_ADAPTERS, { message: `must be one of ${MAIL_ADAPTERS.join('|')}` })
  MAIL_ADAPTER?: MailAdapterName;

  @ValidateIf(usesSmtp)
  @IsString({ message: MAIL_SMTP_HOST_RULE })
  @Matches(MAIL_SMTP_HOST_PATTERN, { message: MAIL_SMTP_HOST_RULE })
  MAIL_SMTP_HOST?: string;

  @ValidateIf(usesSmtp)
  @Type(() => Number)
  @IsInt({ message: PORT_RULE })
  @Min(1, { message: PORT_RULE })
  @Max(65535, { message: PORT_RULE })
  MAIL_SMTP_PORT?: number;

  // `dev` and `test`: default `DEFAULT_MAIL_FROM`; `demo` and `prod`: required.
  @ValidateIf(presentOrRequiredInDeployedTiers('MAIL_FROM'))
  @IsEmail({}, { message: 'must be an email address' })
  MAIL_FROM?: string;

  @AuthValue(checkPrivateKey)
  JWT_PRIVATE_KEY!: string;

  @AuthValue(checkPublicKey)
  JWT_PUBLIC_KEY!: string;

  @AuthValue(checkKeyId)
  JWT_KEY_ID!: string;

  @IsOptional()
  @AuthValue(checkPreviousPublicKeys)
  JWT_PREVIOUS_PUBLIC_KEYS?: string;

  @AuthValue(checkSecret)
  OTP_HMAC_SECRET!: string;

  @AuthValue(checkEncryptionKey)
  MFA_ENCRYPTION_KEY!: string;

  @IsOptional()
  @AuthValue(checkPreviousEncryptionKeys)
  MFA_ENCRYPTION_PREVIOUS_KEYS?: string;

  // Social sign-in `aud` allow-lists (A2-T6; names from decision 0008 section 11). Optional in every
  // tier (api-divergences D-068): a provider without a client id answers `NOT_FOUND`.
  @IsOptional()
  @AuthValue(checkSocialClientIds)
  GOOGLE_CLIENT_IDS?: string;

  @IsOptional()
  @AuthValue(checkSocialClientIds)
  APPLE_CLIENT_IDS?: string;

  // The allowed `Origin` values of `POST /admin/auth/*` (A3-T1; decision 0008 section 10). `dev` and
  // `test`: default `DEFAULT_ADMIN_ORIGINS`; `demo` and `prod`: required, `https` only.
  @ValidateIf(
    (env: ServerEnvironment) =>
      env.ADMIN_ORIGINS !== undefined || ADMIN_ORIGINS_REQUIRED_IN.includes(env.APP_ENV),
  )
  @AdminOriginList()
  ADMIN_ORIGINS?: string;
}
