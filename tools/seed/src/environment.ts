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
