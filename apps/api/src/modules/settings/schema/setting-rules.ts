import { FIELD_ERROR_CODES } from '@kd/contracts';
import type { FieldErrorCode } from '@kd/contracts';
import { plainToInstance } from 'class-transformer';
import type { ClassConstructor } from 'class-transformer';
import { ValidateBy, validateSync } from 'class-validator';
import type { ValidationArguments, ValidationError, ValidationOptions } from 'class-validator';

import type { ApiFieldError } from '../../../common/errors/api-error.js';
import type { SettingStorageKey } from '../entities/app-setting.entity.js';

/**
 * The keys of the API representation (camelCase, api-outline `/admin/app-settings` and
 * `/meta/config`), in data-model order. Each maps to one storage key of `app_settings.key`.
 */
export const SETTING_KEYS = [
  'brand',
  'reports',
  'minAppVersion',
  'maintenance',
  'featureFlags',
  'payment',
  'ordering',
  'loyalty',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** A value that passed its key's rules, or the field errors with their full camelCase path. */
export type SettingParseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly errors: readonly ApiFieldError[] };

/**
 * One key: its camelCase DTO rules and the pair of mapping functions to and from the snake_case
 * object stored in `app_settings.value` (data-model names). `parse` returns a plain object.
 */
export interface SettingSchema<Key extends SettingKey, Value, Stored> {
  readonly key: Key;
  readonly storageKey: SettingStorageKey;
  parse(raw: unknown): SettingParseResult<Value>;
  toStored(value: Value): Stored;
  fromStored(stored: Stored): Value;
}

export interface SettingSchemaDefinition<Key extends SettingKey, Value, Stored> {
  readonly key: Key;
  readonly storageKey: SettingStorageKey;
  readonly dto: ClassConstructor<Value>;
  toStored(value: Value): Stored;
  fromStored(stored: Stored): Value;
}

/** Builds a key's schema; `parse` validates with the DTO, then maps out and back to a plain value. */
export function defineSettingSchema<Key extends SettingKey, Value, Stored>(
  definition: SettingSchemaDefinition<Key, Value, Stored>,
): SettingSchema<Key, Value, Stored> {
  const { key, storageKey, dto, toStored, fromStored } = definition;
  return {
    key,
    storageKey,
    toStored,
    fromStored,
    parse(raw) {
      const result = validateSettingDto(dto, raw, key);
      return result.ok ? { ok: true, value: fromStored(toStored(result.value)) } : result;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Field errors. The global pipe maps class-validator constraint names to the catalogue
// (common/errors/validation.pipe.ts) and gives `INVALID` to any other; the rules below are
// registered under the catalogue code itself (for example `INVALID_TAX_CODE`), so the settings
// mapper uses that name as the code. The message is chosen from the code, never from the value.
// ---------------------------------------------------------------------------------------------

/** class-validator built-in constraint names → catalogue code. */
const BUILT_IN_CODES: Readonly<Record<string, FieldErrorCode>> = {
  isDefined: 'REQUIRED',
  isNotEmpty: 'REQUIRED',
  whitelistValidation: 'INVALID',
  nestedValidation: 'INVALID',
  isString: 'INVALID',
  isInt: 'INVALID',
  isBoolean: 'INVALID',
  isUuid: 'INVALID',
  isIso8601: 'INVALID_FORMAT',
  // An exact length (`payment.bankCode`, 6 digits) is a format, not a bound.
  isLength: 'INVALID_FORMAT',
  isEmail: 'INVALID_EMAIL',
  maxLength: 'TOO_LONG',
  min: 'OUT_OF_RANGE',
  max: 'OUT_OF_RANGE',
  isIn: 'OUT_OF_RANGE',
};

/**
 * When a field breaks several rules, the first code of this list is reported: a missing value,
 * then a wrong type, then a malformed value, then a bound, then a rule between two fields.
 */
const CODE_PRIORITY: readonly FieldErrorCode[] = [
  'REQUIRED',
  'INVALID',
  'INVALID_FORMAT',
  'INVALID_TIME',
  'INVALID_PHONE',
  'INVALID_EMAIL',
  'INVALID_TAX_CODE',
  'TOO_LONG',
  'OUT_OF_RANGE',
  'MUST_BE_LESS_THAN_LATE',
  'MUST_EXCEED_ACCEPT_LATE',
];

const MESSAGES: Readonly<Partial<Record<FieldErrorCode, string>>> = {
  REQUIRED: 'is required',
  INVALID_FORMAT: 'has an invalid format',
  INVALID_TIME: 'must be a time of day HH:mm',
  INVALID_PHONE: 'must be a phone number in E.164 form',
  INVALID_EMAIL: 'must be a valid email address',
  INVALID_TAX_CODE: 'must be 10 or 13 digits',
  TOO_LONG: 'is too long',
  OUT_OF_RANGE: 'is out of range',
  MUST_BE_LESS_THAN_LATE: 'must be less than the late threshold',
  MUST_EXCEED_ACCEPT_LATE: 'must exceed the accept late threshold',
};

const FIELD_CODES: ReadonlySet<string> = new Set(FIELD_ERROR_CODES);

function codeOf(constraint: string): FieldErrorCode {
  return (
    BUILT_IN_CODES[constraint] ??
    (FIELD_CODES.has(constraint) ? (constraint as FieldErrorCode) : 'INVALID')
  );
}

function rank(code: FieldErrorCode): number {
  const index = CODE_PRIORITY.indexOf(code);
  return index === -1 ? CODE_PRIORITY.length : index;
}

function fieldError(field: string, constraints: readonly string[]): ApiFieldError {
  if (constraints.includes('whitelistValidation')) {
    return { field, code: 'INVALID', message: 'is not allowed' };
  }
  const code = constraints
    .map(codeOf)
    .reduce((best, next) => (rank(next) < rank(best) ? next : best));
  return { field, code, message: MESSAGES[code] ?? 'is invalid' };
}

/** One entry per field, with the dotted camelCase path under `parent` (the API key). */
export function settingFieldErrors(
  errors: readonly ValidationError[],
  parent: string,
): ApiFieldError[] {
  const result: ApiFieldError[] = [];
  for (const error of errors) {
    const field = `${parent}.${error.property}`;
    const constraints = Object.keys(error.constraints ?? {});
    if (constraints.length > 0) {
      result.push(fieldError(field, constraints));
    }
    if (error.children !== undefined && error.children.length > 0) {
      result.push(...settingFieldErrors(error.children, field));
    }
  }
  return result;
}

/**
 * Validates `raw` against a key's DTO as the global pipe would (unknown properties refused, no
 * implicit conversion, rejected values kept out of the errors). `field` is the API key.
 */
export function validateSettingDto<Value>(
  dto: ClassConstructor<Value>,
  raw: unknown,
  field: string,
): SettingParseResult<Value> {
  if (raw === undefined || raw === null) {
    return { ok: false, errors: [{ field, code: 'REQUIRED', message: 'is required' }] };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ field, code: 'INVALID', message: 'is invalid' }] };
  }
  const instance = plainToInstance(dto, raw);
  const errors = validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  });
  return errors.length === 0
    ? { ok: true, value: instance }
    : { ok: false, errors: settingFieldErrors(errors, field) };
}

// ---------------------------------------------------------------------------------------------
// Rules named after their catalogue code (api-outline, "Field-level codes"; brief L2).
// ---------------------------------------------------------------------------------------------

/** E.164, the `public.e164_phone` domain of migration 0001; a landline is allowed. */
const E164 = /^\+[1-9]\d{1,14}$/u;
/** 10 or 13 digits, digits only (brief L6). */
const TAX_CODE = /^(?:\d{10}|\d{13})$/u;
/** `HH:mm`, `00:00` to `23:59`: the cutoff that common/time/business-date.ts accepts. */
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
/** `x.y.z`, three non-negative integers without leading zeros (brief L12). */
const VERSION = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/u;
const DIGITS = /^\d+$/u;
const LINE_BREAK = /\r\n|\r|\n/u;

function matching(name: FieldErrorCode, pattern: RegExp, options?: ValidationOptions) {
  return ValidateBy(
    {
      name,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && pattern.test(value),
        defaultMessage: () => MESSAGES[name] ?? 'is invalid',
      },
    },
    options,
  );
}

/**
 * At least one non-space character (`REQUIRED`). A non-string is left to the type rule, so a
 * number reads as `INVALID`, not as missing.
 */
export function IsNotBlank(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'REQUIRED',
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || /\S/u.test(value),
        defaultMessage: () => 'is required',
      },
    },
    options,
  );
}

/** E.164, landline included (`INVALID_PHONE`). */
export function IsE164Phone(options?: ValidationOptions): PropertyDecorator {
  return matching('INVALID_PHONE', E164, options);
}

/** 10 or 13 digits (`INVALID_TAX_CODE`). */
export function IsTaxCode(options?: ValidationOptions): PropertyDecorator {
  return matching('INVALID_TAX_CODE', TAX_CODE, options);
}

/** `HH:mm` (`INVALID_TIME`). */
export function IsTimeOfDay(options?: ValidationOptions): PropertyDecorator {
  return matching('INVALID_TIME', TIME_OF_DAY, options);
}

/** `x.y.z` (`INVALID_FORMAT`). */
export function IsVersion(options?: ValidationOptions): PropertyDecorator {
  return matching('INVALID_FORMAT', VERSION, options);
}

/** Digits only (`INVALID_FORMAT`); the length is a separate rule. */
export function IsDigits(options?: ValidationOptions): PropertyDecorator {
  return matching('INVALID_FORMAT', DIGITS, options);
}

/** At most `max` lines (`TOO_LONG`, brief L7). A non-string is left to the type rule. */
export function MaxLines(max: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'TOO_LONG',
      constraints: [max],
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' || value.split(LINE_BREAK).length <= max,
        defaultMessage: () => 'is too long',
      },
    },
    options,
  );
}

/**
 * The warn threshold is below the late one of the same object (`MUST_BE_LESS_THAN_LATE`, brief
 * L4, A42). Passes when either side is not an integer: the type and range rules report that.
 */
export function IsLessThanProperty(
  property: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'MUST_BE_LESS_THAN_LATE',
      constraints: [property],
      validator: {
        validate: (value: unknown, args?: ValidationArguments) => {
          const late = (args?.object as Record<string, unknown> | undefined)?.[property];
          return (
            !Number.isInteger(value) ||
            !Number.isInteger(late) ||
            (value as number) < (late as number)
          );
        },
        defaultMessage: () => 'must be less than the late threshold',
      },
    },
    options,
  );
}

/**
 * Above the value that `late` reads from the same object (`MUST_EXCEED_ACCEPT_LATE`, brief L8).
 * Passes when either side is not an integer: the type and range rules report that.
 */
export function ExceedsAcceptLate(
  late: (object: Record<string, unknown>) => unknown,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'MUST_EXCEED_ACCEPT_LATE',
      validator: {
        validate: (value: unknown, args?: ValidationArguments) => {
          const bound = late((args?.object ?? {}) as Record<string, unknown>);
          return (
            !Number.isInteger(value) ||
            !Number.isInteger(bound) ||
            (value as number) > (bound as number)
          );
        },
        defaultMessage: () => 'must exceed the accept late threshold',
      },
    },
    options,
  );
}
