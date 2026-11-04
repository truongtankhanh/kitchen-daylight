import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUrl, Max, Min, registerDecorator } from 'class-validator';
import type { ValidationArguments } from 'class-validator';

// Decision 0005, sections 2, 4 and 5. Only the variables that code reads today.

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
}
