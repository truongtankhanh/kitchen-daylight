/**
 * Combining marks left by Unicode canonical decomposition (NFD): the Vietnamese tone marks and the
 * circumflex, breve and horn of `â`, `ă`, `ơ`, `ư`.
 */
const COMBINING_MARKS = /\p{M}/gu;

/** `đ` and `Đ` are letters of their own, not `d` plus a mark, so NFD keeps them. */
const D_WITH_STROKE = /[đĐ]/gu;

/** Every run of characters other than `a-z` and `0-9`. */
const NOT_SLUG_CHARACTERS = /[^a-z0-9]+/gu;

/** Hyphens at either end. */
const EDGE_HYPHENS = /^-+|-+$/gu;

/** The shape of a slug: lower-case letters and digits in groups joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * A URL slug from a display name: diacritics stripped (`đ` and `Đ` become `d`), lower case, every
 * other run of characters one hyphen, no hyphen at either end. `Chi nhánh Bến Thành` →
 * `chi-nhanh-ben-thanh`. Returns the empty string when nothing is left (a name of symbols only);
 * the caller decides what that means. The documents give no slug rule (api-divergences D-130).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(D_WITH_STROKE, 'd')
    .toLowerCase()
    .replace(NOT_SLUG_CHARACTERS, '-')
    .replace(EDGE_HYPHENS, '');
}
