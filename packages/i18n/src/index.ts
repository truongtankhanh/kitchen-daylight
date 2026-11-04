// Locale registry. Framework-neutral: the admin and mobile apps write their own adapters.
// Adding a locale is data only: a new catalogue under locales/ typed as `Catalogue` and one entry
// below. A missing key fails `typecheck` here and the package `check` script.
import { vi } from './locales/vi.js';
import type { Catalogue } from './types.js';

export type { Catalogue, MessageKey, Namespace, Widen } from './types.js';

export const catalogues = {
  vi,
} as const satisfies Readonly<Record<string, Catalogue>>;

export type Locale = keyof typeof catalogues;

export const DEFAULT_LOCALE: Locale = 'vi';

export const LOCALES = Object.keys(catalogues) as readonly Locale[];
