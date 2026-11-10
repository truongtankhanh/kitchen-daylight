import { randomUUIDv7 } from 'node:crypto';

// Decision 0009 section 6: object keys are built here and only here, from the media id, the month
// of `created_at` (UTC) and the fixed variant names. No caller input, and never the uploaded file
// name, reaches a key.

/** Every stored variant; `master` is the source for later variants and is never returned. */
export const MEDIA_VARIANTS = ['thumb', 'medium', 'large', 'master'] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

/** The variants a client receives (decision 0009 section 7). */
export const PUBLIC_MEDIA_VARIANTS = ['thumb', 'medium', 'large'] as const;
export type PublicMediaVariant = (typeof PUBLIC_MEDIA_VARIANTS)[number];

/** A UUID in its canonical lower-case form, as PostgreSQL prints it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** `media.storage_key`: `media/<yyyy>/<mm>/<media id>` (the `CHECK` of migration 0014). */
export const MEDIA_STORAGE_KEY =
  /^media\/[0-9]{4}\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A new media id: UUIDv7, generated before the insert because the keys need it. */
export function newMediaId(): string {
  return randomUUIDv7();
}

/**
 * The prefix stored in `media.storage_key`, from the id and the creation instant (UTC year and
 * month). Throws on anything but a canonical UUID or a valid date, so no other text can enter a key.
 */
export function mediaStorageKey(mediaId: string, createdAt: Date): string {
  if (!UUID.test(mediaId)) {
    throw new Error('mediaStorageKey: the media id must be a canonical UUID');
  }
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('mediaStorageKey: invalid creation date');
  }
  const year = String(createdAt.getUTCFullYear()).padStart(4, '0');
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  return `media/${year}/${month}/${mediaId}`;
}

/** The object key of one variant: `<storage key>/<variant>.webp`. */
export function mediaVariantKey(storageKey: string, variant: MediaVariant): string {
  if (!MEDIA_STORAGE_KEY.test(storageKey)) {
    throw new Error('mediaVariantKey: not a media storage key');
  }
  return `${storageKey}/${variant}.webp`;
}

/** Every object key of a media row, for a write rollback or the cleanup job (A12-T2). */
export function mediaObjectKeys(storageKey: string): string[] {
  return MEDIA_VARIANTS.map((variant) => mediaVariantKey(storageKey, variant));
}
