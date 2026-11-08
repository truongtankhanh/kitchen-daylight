// The rules of the eight `app_settings` values, as stored (snake_case, data-model `app_settings`),
// for the `app-settings` step (the defaults file) and `verify reference` (the stored rows).
//
// A hand-written mirror of the API's DTOs in apps/api/src/modules/settings/schema/*.schema.ts and
// setting-rules.ts: `@kd/seed` may not import `@kd/api` (decision 0003 section 6), so the two can
// drift (api-divergences D-122). They check shape and ranges, never equality with a default. A
// shared check is a follow-up.

/** The storage keys of migration `0011_app_settings.sql` (`app_settings_key_known`), in its order. */
export const SETTING_STORAGE_KEYS = [
  'brand',
  'reports',
  'min_app_version',
  'maintenance',
  'feature_flags',
  'payment',
  'ordering',
  'loyalty',
] as const;
export type SettingStorageKey = (typeof SETTING_STORAGE_KEYS)[number];

/** Records the dotted path of every field that breaks a rule. Paths only, never a value. */
type Rule = (value: unknown, path: string, issues: string[]) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function join(path: string, field: string): string {
  return path === '' ? field : `${path}.${field}`;
}

/** Every listed field present, no other field (the API refuses unknown properties). */
function object(fields: Readonly<Record<string, Rule>>, extra?: Rule): Rule {
  return (value, path, issues) => {
    if (!isRecord(value)) {
      issues.push(path === '' ? '(value)' : path);
      return;
    }
    for (const [field, rule] of Object.entries(fields)) {
      if (!Object.hasOwn(value, field)) {
        issues.push(join(path, field));
      } else {
        rule(value[field], join(path, field), issues);
      }
    }
    for (const field of Object.keys(value)) {
      if (!Object.hasOwn(fields, field)) {
        issues.push(join(path, field));
      }
    }
    extra?.(value, path, issues);
  };
}

/** `null`, or a value that passes `rule`. */
function nullable(rule: Rule): Rule {
  return (value, path, issues) => {
    if (value !== null) {
      rule(value, path, issues);
    }
  };
}

interface TextOptions {
  /** At least one non-space character (`IsNotBlank`). */
  readonly notBlank?: boolean;
  /** UTF-16 length, as class-validator's `MaxLength`. */
  readonly max?: number;
  readonly maxLines?: number;
  readonly pattern?: RegExp;
}

const LINE_BREAK = /\r\n|\r|\n/u;

function text(options: TextOptions = {}): Rule {
  return (value, path, issues) => {
    if (
      typeof value !== 'string' ||
      (options.notBlank === true && !/\S/u.test(value)) ||
      (options.max !== undefined && value.length > options.max) ||
      (options.maxLines !== undefined && value.split(LINE_BREAK).length > options.maxLines) ||
      (options.pattern !== undefined && !options.pattern.test(value))
    ) {
      issues.push(path);
    }
  };
}

function int(min: number, max: number): Rule {
  return (value, path, issues) => {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      issues.push(path);
    }
  };
}

const bool: Rule = (value, path, issues) => {
  if (typeof value !== 'boolean') {
    issues.push(path);
  }
};

function oneOf(values: readonly unknown[]): Rule {
  return (value, path, issues) => {
    if (!values.includes(value)) {
      issues.push(path);
    }
  };
}

/** `warn < late` of one object (`MUST_BE_LESS_THAN_LATE`), checked when both are integers. */
function lessThan(warnField: string, lateField: string): Rule {
  return (value, path, issues) => {
    const record = value as Record<string, unknown>;
    const warn = record[warnField];
    const late = record[lateField];
    if (Number.isInteger(warn) && Number.isInteger(late) && (warn as number) >= (late as number)) {
      issues.push(join(path, warnField));
    }
  };
}

// The patterns of apps/api/src/modules/settings/schema/setting-rules.ts.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const E164 = /^\+[1-9]\d{1,14}$/u;
const TAX_CODE = /^(?:\d{10}|\d{13})$/u;
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const VERSION = /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/u;
const DIGITS = /^\d+$/u;
const BANK_CODE = /^\d{6}$/u;
/** A plain shape check; the API's `IsEmail` is stricter. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
/** An ISO 8601 instant with a date, a time and a zone (`IsISO8601` strict). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

const instant: Rule = (value, path, issues) => {
  if (typeof value !== 'string' || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push(path);
  }
};

const uuid = text({ pattern: UUID });

/** A threshold in minutes (`ORDERING_BOUNDS.thresholdMinutes`). */
const threshold = int(1, 240);
const thresholdPair = object({ warn: threshold, late: threshold }, lessThan('warn', 'late'));

/** The largest `integer` of PostgreSQL, the bound of the `vnd` domain. */
const INT4_MAX = 2_147_483_647;

/** `auto_cancel_unaccepted_minutes`, when set, exceeds `board_thresholds.accept.late`. */
const autoCancelExceedsAcceptLate: Rule = (value, path, issues) => {
  const record = value as Record<string, unknown>;
  const autoCancel = record['auto_cancel_unaccepted_minutes'];
  const thresholds = record['board_thresholds'];
  const accept = isRecord(thresholds) ? thresholds['accept'] : undefined;
  const late = isRecord(accept) ? accept['late'] : undefined;
  if (
    Number.isInteger(autoCancel) &&
    Number.isInteger(late) &&
    (autoCancel as number) <= (late as number)
  ) {
    issues.push(join(path, 'auto_cancel_unaccepted_minutes'));
  }
};

const RULES: Readonly<Record<SettingStorageKey, Rule>> = {
  brand: object({
    name: text({ notBlank: true, max: 100 }),
    logo: nullable(uuid),
    hotline: nullable(text({ pattern: E164 })),
    support_email: nullable(text({ max: 254, pattern: EMAIL })),
    business_address: nullable(text({ notBlank: true, max: 255 })),
    tax_code: nullable(text({ pattern: TAX_CODE })),
    receipt: object({
      title: text({ notBlank: true, max: 40 }),
      footer: text({ max: 200, maxLines: 4 }),
      paper_width: oneOf([58, 80]),
      show_tax_code: bool,
    }),
  }),
  reports: object({ business_day_starts_at: text({ pattern: TIME_OF_DAY }) }),
  min_app_version: object({
    ios: text({ pattern: VERSION }),
    android: text({ pattern: VERSION }),
  }),
  maintenance: object({
    enabled: bool,
    message: nullable(text({ notBlank: true, max: 500 })),
    expected_back_at: nullable(instant),
    since: nullable(instant),
  }),
  feature_flags: object({
    ordering: bool,
    delivery: bool,
    reservations: bool,
    loyalty: bool,
    vouchers: bool,
    promotions: bool,
    charts: bool,
    einvoice: bool,
  }),
  payment: object({
    bank_name: nullable(text({ notBlank: true, max: 100 })),
    account_number: nullable(text({ max: 30, pattern: DIGITS })),
    account_holder: nullable(text({ notBlank: true, max: 100 })),
    transfer_note_rule: nullable(text({ notBlank: true, max: 100 })),
    bank_code: nullable(text({ pattern: BANK_CODE })),
    qr_media_id: nullable(uuid),
  }),
  ordering: object(
    {
      max_item_quantity: int(1, 99),
      max_cart_lines: int(1, 100),
      item_note_max: int(1, 200),
      schedule_min_lead_minutes: int(0, 1440),
      schedule_max_days_ahead: int(0, 30),
      review_window_days: int(1, 90),
      auto_cancel_unaccepted_minutes: nullable(int(1, 1440)),
      board_thresholds: object({ accept: thresholdPair, ready: thresholdPair }),
      board_refetch_seconds: int(5, 300),
      ready_unserved_warn_minutes: threshold,
      ready_unserved_late_minutes: threshold,
      call_hint_minutes: int(1, 240),
      list_max_range_days: int(1, 366),
    },
    (value, path, issues) => {
      lessThan('ready_unserved_warn_minutes', 'ready_unserved_late_minutes')(value, path, issues);
      autoCancelExceedsAcceptLate(value, path, issues);
    },
  ),
  loyalty: object({
    earn_vnd_per_point: nullable(int(1, INT4_MAX)),
    redeem_vnd_per_point: nullable(int(1, INT4_MAX)),
    min_redeem_points: nullable(int(1, INT4_MAX)),
    expiry_months: nullable(int(1, 120)),
  }),
};

export function isSettingStorageKey(value: string): value is SettingStorageKey {
  return (SETTING_STORAGE_KEYS as readonly string[]).includes(value);
}

/**
 * The fields of a stored value that break its key's rules, as dotted paths below the key (for
 * example `receipt.paper_width`; `(value)` when it is not an object). Empty when the value passes.
 */
export function settingIssues(key: SettingStorageKey, value: unknown): string[] {
  const issues: string[] = [];
  RULES[key](value, '', issues);
  return issues;
}
