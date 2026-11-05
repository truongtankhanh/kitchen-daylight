// Guard for data that must never carry personal data or secrets: realtime outbox payloads first
// (data-model `outbox_events`: "no personal data or record content"; ADR-0007 "signal, then fetch").

/**
 * Words that mark a key as personal data or a secret. A key is split into words (camelCase,
 * snake_case, kebab-case) and compared case-insensitively, plural included: `customerPhone`,
 * `contact_name` and `accessTokens` are refused. An actor `{ id, name }` stays allowed: the
 * Realtime table puts the staff actor in the branch staff copy.
 */
export const PERSONAL_DATA_WORDS: readonly string[] = [
  'email',
  'phone',
  'password',
  'token',
  'code',
  'address',
  'contact',
  'secret',
];

export interface PersonalDataGuardOptions {
  /** More words to refuse for one caller, compared like the default list. */
  readonly extraWords?: readonly string[];
}

/** A payload holds a refused key. Programmer error: the message names the path, never a value. */
export class PersonalDataError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Personal data or secret key "${path}" is not allowed here.`);
    this.name = 'PersonalDataError';
    this.path = path;
  }
}

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

function isRefused(key: string, refused: ReadonlySet<string>): boolean {
  return words(key).some(
    (word) =>
      refused.has(word) ||
      (word.endsWith('es') && refused.has(word.slice(0, -2))) ||
      (word.endsWith('s') && refused.has(word.slice(0, -1))),
  );
}

function walk(
  value: unknown,
  path: string,
  refused: ReadonlySet<string>,
  seen: WeakSet<object>,
): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${index}]`, refused, seen);
    });
    return;
  }
  for (const [key, member] of Object.entries(value)) {
    const memberPath = path === '' ? key : `${path}.${key}`;
    if (isRefused(key, refused)) {
      throw new PersonalDataError(memberPath);
    }
    walk(member, memberPath, refused, seen);
  }
}

/**
 * Throws `PersonalDataError` when any key, at any depth (objects and arrays), is a refused word.
 * Only key names are checked; values are never read into the error.
 */
export function assertNoPersonalData(
  payload: unknown,
  options: PersonalDataGuardOptions = {},
): void {
  const refused = new Set(
    [...PERSONAL_DATA_WORDS, ...(options.extraWords ?? [])].map((word) => word.toLowerCase()),
  );
  walk(payload, '', refused, new WeakSet());
}
