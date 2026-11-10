import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { ALT_MAX_LENGTH, MEDIA_PURPOSES } from '../media-rules.js';
import type { MediaPurpose } from '../media-rules.js';

/**
 * The text fields of the multipart body of `POST /api/v1/admin/uploads/images`. The file itself
 * (`file`) is read by multer, not by this DTO; the OpenAPI body is `UPLOAD_IMAGE_BODY_SCHEMA`.
 */
export class UploadImageDto {
  /**
   * Alternative text, at most 200 characters; trimmed, blank stored as no text. Ignored when the
   * same bytes are already stored (the existing row is returned unchanged).
   */
  @IsOptional()
  @IsString()
  @MaxLength(ALT_MAX_LENGTH)
  alt?: string;

  /** `PHOTO` (default, `MANAGER` or `ADMIN`) or `LOGO` (`ADMIN`; at most 2 MB, at least 256 px). */
  @IsOptional()
  @IsIn(MEDIA_PURPOSES)
  purpose?: MediaPurpose;
}

/** The OpenAPI schema of the multipart body: the file plus the fields of `UploadImageDto`. */
export const UPLOAD_IMAGE_BODY_SCHEMA = Object.freeze({
  type: 'object',
  required: ['file'],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
      description: 'JPEG, PNG or WebP; at most 10 MB (2 MB for LOGO).',
    },
    alt: { type: 'string', maxLength: ALT_MAX_LENGTH },
    purpose: { type: 'string', enum: [...MEDIA_PURPOSES], default: 'PHOTO' },
  },
});
