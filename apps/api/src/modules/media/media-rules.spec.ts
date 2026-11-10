import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import {
  ALT_MAX_LENGTH,
  assertUploadPurpose,
  assertUploadSize,
  codePointLength,
  LOGO_MAX_BYTES,
  LOGO_MIN_SHORT_SIDE,
  normalizeAlt,
  PHOTO_MAX_BYTES,
  purposeViolation,
  UPLOAD_MULTER_LIMITS,
} from './media-rules.js';

function caught(work: () => unknown): ApiError {
  try {
    work();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an ApiError');
}

describe('media rules', () => {
  it('keeps the limits of decision 0009', () => {
    expect(PHOTO_MAX_BYTES).toBe(10_485_760);
    expect(LOGO_MAX_BYTES).toBe(2_097_152);
    expect(LOGO_MIN_SHORT_SIDE).toBe(256);
    expect(ALT_MAX_LENGTH).toBe(200);
    expect(UPLOAD_MULTER_LIMITS).toEqual({
      fileSize: PHOTO_MAX_BYTES,
      files: 1,
      fields: 2,
      parts: 3,
      fieldSize: 1024,
    });
  });

  describe('alt', () => {
    it('counts code points, as char_length does', () => {
      expect(codePointLength('Phở bò')).toBe(6);
      expect(codePointLength('🍜🍜')).toBe(2);
    });

    it('trims and stores a blank text as null', () => {
      expect(normalizeAlt('  Phở bò tái  ')).toBe('Phở bò tái');
      expect(normalizeAlt('   ')).toBeNull();
      expect(normalizeAlt(undefined)).toBeNull();
      expect(normalizeAlt(null)).toBeNull();
    });

    it('accepts 200 code points, also of characters outside the BMP', () => {
      expect(normalizeAlt('ả'.repeat(200))).toHaveLength(200);
      expect(codePointLength(normalizeAlt('🍜'.repeat(200)) ?? '')).toBe(200);
    });

    it('refuses 201 code points with TOO_LONG on alt', () => {
      const error = caught(() => normalizeAlt('a'.repeat(201)));

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.errors).toEqual([{ field: 'alt', code: 'TOO_LONG', message: 'is too long' }]);
    });
  });

  describe('purpose', () => {
    const square = (side: number, bytes = 1000) => ({ bytes, width: side, height: side });

    it('lets any photo within the upload limit through', () => {
      expect(purposeViolation('PHOTO', square(16))).toBeNull();
      expect(purposeViolation('PHOTO', square(16, PHOTO_MAX_BYTES))).toBeNull();
      expect(purposeViolation('PHOTO', square(16, PHOTO_MAX_BYTES + 1))).toBe('TOO_LARGE');
    });

    it('needs a logo of at most 2 MiB with a shorter side of at least 256 px', () => {
      expect(purposeViolation('LOGO', square(256))).toBeNull();
      expect(purposeViolation('LOGO', { bytes: 1000, width: 1024, height: 256 })).toBeNull();
      expect(purposeViolation('LOGO', { bytes: 1000, width: 1024, height: 255 })).toBe('TOO_SMALL');
      expect(purposeViolation('LOGO', square(512, LOGO_MAX_BYTES))).toBeNull();
      expect(purposeViolation('LOGO', square(512, LOGO_MAX_BYTES + 1))).toBe('TOO_LARGE');
    });

    it('answers a too small logo with OUT_OF_RANGE on file', () => {
      const error = caught(() => assertUploadPurpose('LOGO', square(255)));

      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.errors?.map(({ field, code }) => ({ field, code }))).toEqual([
        { field: 'file', code: 'OUT_OF_RANGE' },
      ]);
    });

    it('answers a too large logo with 413 TOO_LARGE, before and after decoding', () => {
      expect(caught(() => assertUploadSize('LOGO', LOGO_MAX_BYTES + 1)).code).toBe('TOO_LARGE');
      expect(caught(() => assertUploadPurpose('LOGO', square(512, LOGO_MAX_BYTES + 1))).code).toBe(
        'TOO_LARGE',
      );
      expect(() => assertUploadSize('LOGO', LOGO_MAX_BYTES)).not.toThrow();
      expect(() => assertUploadSize('PHOTO', LOGO_MAX_BYTES + 1)).not.toThrow();
    });
  });
});
