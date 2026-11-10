/**
 * The amenity icon keys (data-model `amenities` row; api-outline "Menu and stock", brief B32): the
 * single list the API checks `amenities.icon` against. A `CHECK` would freeze it, so the database
 * keeps a plain `text` column and the list can grow here. Who owns the list, and whether
 * `GET /meta/config` serves it, are open (brief B32). `tools/seed/src/steps/vocabulary.ts` holds a
 * mirror (the seed may not import `@kd/api`): change both together.
 */
export const AMENITY_ICONS = Object.freeze([
  'wifi',
  'car',
  'snow',
  'tree',
  'door',
  'child',
  'wheelchair',
  'box',
] as const);

export type AmenityIcon = (typeof AMENITY_ICONS)[number];

export function isAmenityIcon(value: unknown): value is AmenityIcon {
  return typeof value === 'string' && (AMENITY_ICONS as readonly string[]).includes(value);
}
