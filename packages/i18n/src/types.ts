import type { vi } from './locales/vi.js';

/** Same keys as `T`, every message widened to `string`, so a locale is not tied to the Vietnamese text. */
export type Widen<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]>;
};

/** The shape every locale must have: the keys of the default (`vi`) catalogue. */
export type Catalogue = Widen<typeof vi>;

/** Top-level groups of the catalogue (`common`, `errors`). */
export type Namespace = keyof Catalogue;

type KeyPath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : KeyPath<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Dot-separated path of every message, for example `common.appName`. */
export type MessageKey = KeyPath<Catalogue>;
