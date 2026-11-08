import { isAbsolute } from 'node:path';

// Configuration of the seed tool: the database URL rule of decision 0005 section 2 and the
// `APP_ENV` gate of each mode. Written here, not imported: `@kd/seed` imports nothing from
// `apps/api` (decision 0003 section 6). Messages name the variable and the rule, never a value.

export const APP_ENVS = ['dev', 'test', 'demo', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export type Environment = Readonly<Record<string, string | undefined>>;

export interface SeedConfig {
  readonly appEnv: AppEnv;
  /** As `kd_migrator`. Never printed. */
  readonly databaseUrl: string;
}

export interface ConfigIssue {
  /** Variable name(s), never a value. */
  readonly name: string;
  readonly rule: string;
}

/** Thrown when the environment is invalid. The message holds names and rules only. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(issues.map(({ name, rule }) => `${name}: ${rule}`).join('\n'));
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** The container name; on the host the tool runs as `kd_migrator` (decision 0005 section 8). */
const CONTAINER_DATABASE_URL = 'DATABASE_URL';
const HOST_DATABASE_URL = 'DATABASE_URL_MIGRATOR';

/** An empty value counts as unset. */
function read(env: Environment, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVS as readonly string[]).includes(value);
}

function isPostgresUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const { protocol, hostname, pathname } = new URL(value);
  return (
    (protocol === 'postgres:' || protocol === 'postgresql:') &&
    hostname !== '' &&
    pathname.length > 1
  );
}

/**
 * Validates `APP_ENV` and the database URL: `DATABASE_URL` in a container, `DATABASE_URL_MIGRATOR`
 * on the host, both set is ambiguous. Pure: reads only `env`; throws `ConfigError`.
 */
export function readSeedConfig(env: Environment): SeedConfig {
  const issues: ConfigIssue[] = [];

  const appEnv = read(env, 'APP_ENV');
  if (appEnv === undefined) {
    issues.push({ name: 'APP_ENV', rule: 'required' });
  } else if (!isAppEnv(appEnv)) {
    issues.push({ name: 'APP_ENV', rule: `must be one of ${APP_ENVS.join('|')}` });
  }

  const present = [CONTAINER_DATABASE_URL, HOST_DATABASE_URL].filter(
    (name) => read(env, name) !== undefined,
  );
  let databaseUrl: string | undefined;
  if (present.length > 1) {
    issues.push({ name: present.join(', '), rule: 'ambiguous, set only one' });
  } else if (present.length === 0) {
    issues.push({
      name: HOST_DATABASE_URL,
      rule: `required (${CONTAINER_DATABASE_URL} in a container)`,
    });
  } else {
    const name = present[0] as string;
    const value = read(env, name) as string;
    if (isPostgresUrl(value)) {
      databaseUrl = value;
    } else {
      issues.push({ name, rule: 'must be a postgres:// URL with a host and a database' });
    }
  }

  if (issues.length > 0 || appEnv === undefined || !isAppEnv(appEnv) || databaseUrl === undefined) {
    throw new ConfigError(issues);
  }
  return Object.freeze({ appEnv, databaseUrl });
}

/**
 * Refuses a mode outside the `APP_ENV` values of its row (`demo` in `prod`), with exit 3.
 * Throws `ConfigError`.
 */
export function assertModeAllowed(mode: string, allowed: readonly AppEnv[], appEnv: AppEnv): void {
  if (!allowed.includes(appEnv)) {
    throw new ConfigError([
      { name: 'APP_ENV', rule: `seed ${mode} runs only with APP_ENV ${allowed.join('|')}` },
    ]);
  }
}

// ---------------------------------------------------------------------------------------------
// The first ADMIN of `seed reference` (step `first-admin`, A4-T5; decision 0005 section 2). Both
// variables are set, or neither (the step is then skipped). The values are personal data: a message
// names the variable and the rule only, and the report prints the email domain only.
// ---------------------------------------------------------------------------------------------

export const SEED_ADMIN_EMAIL = 'SEED_ADMIN_EMAIL';
export const SEED_ADMIN_NAME = 'SEED_ADMIN_NAME';

/** RFC 5321 path limit, as `users.email` and the API's email rules. */
export const ADMIN_EMAIL_MAX_LENGTH = 254;
/** `users_display_name_length` of migration 0007 (mobile G95), in characters. */
export const ADMIN_NAME_MAX_LENGTH = 60;

/** A plain shape check: one `@`, a dot in the domain, no space. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface FirstAdmin {
  /** Trimmed and lower-cased, as the API stores an email. Never printed in full. */
  readonly email: string;
  /** Trimmed, NFC; 1 to 60 characters. */
  readonly name: string;
}

/**
 * Reads `SEED_ADMIN_EMAIL` and `SEED_ADMIN_NAME`. `null` when both are unset (the step is skipped);
 * `ConfigError` (exit 3) when only one is set, the email is not an address of at most 254
 * characters, or the name is not 1 to 60 characters after trimming. Pure: reads only `env`.
 */
export function readFirstAdmin(env: Environment): FirstAdmin | null {
  const rawEmail = read(env, SEED_ADMIN_EMAIL);
  const rawName = read(env, SEED_ADMIN_NAME);
  if (rawEmail === undefined && rawName === undefined) {
    return null;
  }

  const issues: ConfigIssue[] = [];
  const email = rawEmail?.trim().toLowerCase();
  const name = rawName?.trim().normalize('NFC');
  if (email === undefined) {
    issues.push({ name: SEED_ADMIN_EMAIL, rule: `required when ${SEED_ADMIN_NAME} is set` });
  } else if (email.length > ADMIN_EMAIL_MAX_LENGTH || !EMAIL.test(email)) {
    issues.push({
      name: SEED_ADMIN_EMAIL,
      rule: `must be an email address of at most ${ADMIN_EMAIL_MAX_LENGTH} characters`,
    });
  }
  if (name === undefined) {
    issues.push({ name: SEED_ADMIN_NAME, rule: `required when ${SEED_ADMIN_EMAIL} is set` });
  } else {
    const length = [...name].length;
    if (length < 1 || length > ADMIN_NAME_MAX_LENGTH) {
      issues.push({
        name: SEED_ADMIN_NAME,
        rule: `must be 1 to ${ADMIN_NAME_MAX_LENGTH} characters`,
      });
    }
  }

  if (issues.length > 0 || email === undefined || name === undefined) {
    throw new ConfigError(issues);
  }
  return Object.freeze({ email, name });
}

/** The part after the last `@`: the only piece of the admin email a report may print. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

// ---------------------------------------------------------------------------------------------
// The owner's real Terms and Privacy (step `consent-documents`, api-divergences D-126): a JSON file
// from private storage, never committed. Unset: the committed placeholders are used.
// ---------------------------------------------------------------------------------------------

export const SEED_CONSENT_DOCUMENTS_FILE = 'SEED_CONSENT_DOCUMENTS_FILE';

/**
 * Reads `SEED_CONSENT_DOCUMENTS_FILE`: `null` when unset; an absolute path otherwise, else
 * `ConfigError` (exit 3). The file is read by the step. Pure: reads only `env`.
 */
export function readConsentDocumentsFile(env: Environment): string | null {
  const value = read(env, SEED_CONSENT_DOCUMENTS_FILE);
  if (value === undefined) {
    return null;
  }
  if (!isAbsolute(value)) {
    throw new ConfigError([
      { name: SEED_CONSENT_DOCUMENTS_FILE, rule: 'must be an absolute path to a JSON file' },
    ]);
  }
  return value;
}
