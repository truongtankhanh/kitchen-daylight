import { ApiError } from '../../common/errors/api-error.js';

// Decision 0009 section 5: every number of the media rules lives in this file; nothing else repeats
// one. Banner rules (A15-T5) and the photo counts per item and per branch (A6-T7, A6-T9) are added
// by the tasks that check them.

const MIB = 1024 * 1024;

/** What an upload is for (api-divergences D-149). `PHOTO` is the default. */
export const MEDIA_PURPOSES = ['PHOTO', 'LOGO'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
export const DEFAULT_MEDIA_PURPOSE: MediaPurpose = 'PHOTO';

/** Largest upload: 10 MiB, the lenient reading of the outline's "10 MB" (decision 0009 section 4). */
export const PHOTO_MAX_BYTES = 10 * MIB;
/** Largest logo upload (brief L5): 2 MiB. */
export const LOGO_MAX_BYTES = 2 * MIB;
/** Shortest accepted side of a logo, in pixels of the oriented image (brief L5). */
export const LOGO_MIN_SHORT_SIDE = 256;
/** Decompression-bomb guard: width x height of the source (decision 0009 section 1). */
export const PIXEL_LIMIT = 50_000_000;
/** `alt` length in Unicode code points, the unit of the `CHECK`'s `char_length` (brief C32). */
export const ALT_MAX_LENGTH = 200;
/** An unreferenced row older than this is deleted by the nightly job (A12-T2; decision 0009). */
export const ORPHAN_RETENTION_DAYS = 7;

/**
 * Multer limits of the upload (decision 0009 section 4): one file in `file`, at most the two text
 * fields `alt` and `purpose`, a text field at most 1 KiB. A larger file is Nest's `413`.
 */
export const UPLOAD_MULTER_LIMITS = Object.freeze({
  fileSize: PHOTO_MAX_BYTES,
  files: 1,
  fields: 2,
  parts: 3,
  fieldSize: 1024,
});

/** Code points, as PostgreSQL's `char_length` counts them (not UTF-16 units). */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * The stored form of an `alt` text: trimmed, blank as `null`. Throws `VALIDATION_FAILED` on `alt`
 * with `TOO_LONG` over 200 code points.
 */
export function normalizeAlt(alt: string | null | undefined): string | null {
  if (alt === null || alt === undefined) {
    return null;
  }
  const trimmed = alt.trim();
  if (codePointLength(trimmed) > ALT_MAX_LENGTH) {
    throw new ApiError('VALIDATION_FAILED', {
      errors: [{ field: 'alt', code: 'TOO_LONG', message: 'is too long' }],
    });
  }
  return trimmed === '' ? null : trimmed;
}

/** What the purpose rules read: the uploaded size and the oriented dimensions. */
export interface ImageFacts {
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

/** The purpose rule an image breaks, or `null`. */
export type PurposeViolation = 'TOO_LARGE' | 'TOO_SMALL';

/**
 * The rules of a purpose. `LOGO` (brief L5): at most 2 MiB and a shorter side of at least 256 px.
 * `PHOTO` has no rule beyond the upload limits (10 MiB by multer, the pixel limit).
 */
export function purposeViolation(
  purpose: MediaPurpose,
  facts: ImageFacts,
): PurposeViolation | null {
  if (purpose !== 'LOGO') {
    return facts.bytes > PHOTO_MAX_BYTES ? 'TOO_LARGE' : null;
  }
  if (facts.bytes > LOGO_MAX_BYTES) {
    return 'TOO_LARGE';
  }
  return Math.min(facts.width, facts.height) < LOGO_MIN_SHORT_SIDE ? 'TOO_SMALL' : null;
}

/** Before decoding: a file over its purpose's byte limit is `413 TOO_LARGE`. */
export function assertUploadSize(purpose: MediaPurpose, bytes: number): void {
  const limit = purpose === 'LOGO' ? LOGO_MAX_BYTES : PHOTO_MAX_BYTES;
  if (bytes > limit) {
    throw new ApiError('TOO_LARGE', { detail: 'The file is larger than allowed.' });
  }
}

/**
 * The purpose rules on an upload, after decoding: too large is `413 TOO_LARGE`, too small is
 * `VALIDATION_FAILED` with `OUT_OF_RANGE` on `file`.
 */
export function assertUploadPurpose(purpose: MediaPurpose, facts: ImageFacts): void {
  const violation = purposeViolation(purpose, facts);
  if (violation === 'TOO_LARGE') {
    throw new ApiError('TOO_LARGE', { detail: 'The file is larger than allowed.' });
  }
  if (violation === 'TOO_SMALL') {
    throw new ApiError('VALIDATION_FAILED', {
      errors: [
        {
          field: 'file',
          code: 'OUT_OF_RANGE',
          message: `must be at least ${LOGO_MIN_SHORT_SIDE} px on each side`,
        },
      ],
    });
  }
}
