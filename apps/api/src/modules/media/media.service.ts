import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { RequestUser } from '../../common/auth/request-user.js';
import { ApiError } from '../../common/errors/api-error.js';
import { Clock } from '../../common/time/clock.js';
import {
  ImageDecodeError,
  ImagePixelLimitError,
  probeImage,
  processImage,
} from './image-pipeline.js';
import type { ProbedImage, ProcessedImage } from './image-pipeline.js';
import { IMAGE_CONTENT_TYPES, sniffImageType } from './image-sniffer.js';
import {
  MEDIA_VARIANTS,
  mediaObjectKeys,
  mediaStorageKey,
  mediaVariantKey,
  newMediaId,
} from './media-key.js';
import {
  assertUploadPurpose,
  assertUploadSize,
  normalizeAlt,
  purposeViolation,
} from './media-rules.js';
import type { MediaPurpose } from './media-rules.js';
import { STORAGE_PORT } from './ports/storage.port.js';
import type { StoragePort } from './ports/storage.port.js';

/** Every variant object is immutable: a new variant set gets new names (decision 0009 section 6). */
const VARIANT_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const VARIANT_CONTENT_TYPE = 'image/webp';

// ---------------------------------------------------------------------------------------------
// Views (the DTO classes of `dto/media-image.dto.ts` implement them)
// ---------------------------------------------------------------------------------------------

export interface MediaImageVariantsView {
  readonly thumb: string;
  readonly medium: string;
  readonly large: string;
}

/** The image object of decision 0009 section 7. */
export interface MediaImageView {
  readonly id: string;
  readonly url: string;
  readonly variants: MediaImageVariantsView;
  readonly blurhash: string;
  readonly alt: string | null;
  readonly width: number;
  readonly height: number;
}

export interface UploadedImageView extends MediaImageView {
  readonly duplicate: boolean;
}

/** The columns `toImage` reads; a row of `public.media` or a `Media` entity. */
export interface MediaImageRow {
  readonly id: string;
  readonly storageKey: string;
  readonly blurhash: string;
  readonly altText: string | null;
  readonly width: number;
  readonly height: number;
}

/** What `findOrphans` returns: enough for the cleanup job to delete the row and its objects. */
export interface OrphanMedia {
  readonly id: string;
  readonly storageKey: string;
  readonly createdAt: Date;
}

export interface UploadImageInput {
  /** The uploaded bytes (multer memory storage). The file name is never passed in. */
  readonly bytes: Buffer;
  readonly purpose: MediaPurpose;
  readonly alt?: string | null | undefined;
}

export interface UploadImageResult {
  readonly image: UploadedImageView;
  /** `true` for `201`, `false` for `200` (`duplicate: true`). */
  readonly created: boolean;
}

export interface AssertUsableOptions {
  /** Also checks the purpose's rules from the stored row (for example `LOGO` on `brand.logo`). */
  readonly purpose?: MediaPurpose;
  /** The request field named in `errors[]`; `mediaIds` by default. */
  readonly field?: string;
}

/** The logger methods the service uses (`PinoLogger` in the app, a fake in the spec). */
export type MediaLogger = Pick<PinoLogger, 'info' | 'warn'>;

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

const ROW_COLUMNS = `id::text AS id, storage_key, blurhash, alt_text, width, height`;

interface MediaSqlRow {
  readonly id: string;
  readonly storage_key: string;
  readonly blurhash: string;
  readonly alt_text: string | null;
  readonly width: number;
  readonly height: number;
}

const SELECT_BY_SHA256_SQL = `SELECT ${ROW_COLUMNS} FROM public.media WHERE sha256 = $1`;

/**
 * A parallel upload of the same bytes loses here without an error: `ON CONFLICT (sha256) DO
 * NOTHING` waits for the other insert and returns no row, and the loser answers with the winner.
 */
const INSERT_SQL = `INSERT INTO public.media
  (id, storage_key, content_type, width, height, bytes, sha256, blurhash, alt_text, uploaded_by,
   created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (sha256) DO NOTHING
  RETURNING ${ROW_COLUMNS}`;

const SELECT_FACTS_SQL = `SELECT id::text AS id, bytes, width, height
  FROM public.media WHERE id = ANY($1::uuid[])`;

const UPDATE_ALT_SQL = `UPDATE public.media SET alt_text = $2 WHERE id = $1`;

/**
 * Every place that references a media row today (decision 0009 section 8: one list, in this
 * module). `branches.cover_media_id`, `brand.logo` and the payment QR are still plain ids (A4, A5);
 * the link tables `menu_item_media` and `branch_media`, and banners, are added here by the tasks
 * that create them.
 */
export const MEDIA_REFERENCE_CHECKS = Object.freeze([
  'SELECT 1 FROM public.branches b WHERE b.cover_media_id = m.id',
  `SELECT 1 FROM public.app_settings s WHERE s.key = 'brand' AND s.value->>'logo' = m.id::text`,
  `SELECT 1 FROM public.app_settings s
     WHERE s.key = 'payment' AND s.value->>'qr_media_id' = m.id::text`,
]);

const SELECT_ORPHANS_SQL = `SELECT m.id::text AS id, m.storage_key, m.created_at
  FROM public.media m
  WHERE m.created_at < $1
    ${MEDIA_REFERENCE_CHECKS.map((check) => `AND NOT EXISTS (${check})`).join('\n    ')}
  ORDER BY m.created_at, m.id`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DAY_MS = 24 * 60 * 60 * 1000;

function toRow(row: MediaSqlRow): MediaImageRow {
  return {
    id: row.id,
    storageKey: row.storage_key,
    blurhash: row.blurhash,
    altText: row.alt_text,
    width: row.width,
    height: row.height,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function notFoundError(field: string): ApiError {
  return new ApiError('VALIDATION_FAILED', {
    errors: [{ field, code: 'NOT_FOUND', message: 'names an image that does not exist' }],
  });
}

/**
 * The `media` module's service (decision 0009): the upload of `POST /admin/uploads/images`, and the
 * reads and writes that later tasks call (`assertUsable`, `setAlt`, `toImage`, `findOrphans`). Logs
 * the metadata of an upload only (size, detected type, purpose, outcome): never the bytes, the file
 * name, a key or a URL.
 */
@Injectable()
export class MediaService {
  /** One image processed at a time per instance (decision 0009 section 1). */
  private processing: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PinoLogger) private readonly logger: MediaLogger,
  ) {}

  /**
   * Content check, purpose rules, duplicate lookup, processing, object writes, insert (decision 0009
   * section 8, "Upload order"). `LOGO` is for `ADMIN` only (`403 FORBIDDEN`).
   */
  async upload(actor: RequestUser, input: UploadImageInput): Promise<UploadImageResult> {
    const { bytes, purpose } = input;
    if (purpose === 'LOGO' && actor.role !== 'ADMIN') {
      throw new ApiError('FORBIDDEN', { detail: 'Only an administrator can upload a logo.' });
    }
    const alt = normalizeAlt(input.alt);
    assertUploadSize(purpose, bytes.byteLength);

    const type = sniffImageType(bytes);
    if (type === null) {
      this.logUpload('warn', { bytes: bytes.byteLength, type: null, purpose }, 'unsupported type');
      throw new ApiError('UNSUPPORTED_TYPE', { detail: 'Upload a JPEG, PNG or WebP image.' });
    }
    const probed = await this.probe(bytes, type, purpose);
    assertUploadPurpose(purpose, { bytes: bytes.byteLength, ...probed });

    const sha256 = sha256Hex(bytes);
    const existing = await this.findBySha256(sha256);
    if (existing !== null) {
      this.logUpload('info', { bytes: bytes.byteLength, type, purpose }, 'duplicate upload');
      return { image: { ...this.toImage(existing), duplicate: true }, created: false };
    }

    const processed = await this.process(bytes, type, purpose);
    const id = newMediaId();
    const createdAt = this.clock.now();
    const storageKey = mediaStorageKey(id, createdAt);
    await this.writeObjects(storageKey, processed);

    let inserted: MediaImageRow | null;
    try {
      const rows: MediaSqlRow[] = await this.dataSource.query(INSERT_SQL, [
        id,
        storageKey,
        IMAGE_CONTENT_TYPES[type],
        processed.width,
        processed.height,
        bytes.byteLength,
        sha256,
        processed.blurhash,
        alt,
        actor.id,
        createdAt,
      ]);
      inserted = rows[0] === undefined ? null : toRow(rows[0]);
    } catch (error) {
      await this.deleteObjects(storageKey);
      throw error;
    }

    if (inserted === null) {
      // A parallel upload of the same bytes won: its row is the answer, these objects are spare.
      await this.deleteObjects(storageKey);
      const winner = await this.findBySha256(sha256);
      if (winner === null) {
        throw new Error('media insert conflicted on sha256 but no row was found');
      }
      this.logUpload('info', { bytes: bytes.byteLength, type, purpose }, 'duplicate upload');
      return { image: { ...this.toImage(winner), duplicate: true }, created: false };
    }

    this.logUpload('info', { bytes: bytes.byteLength, type, purpose }, 'image uploaded');
    return { image: { ...this.toImage(inserted), duplicate: false }, created: true };
  }

  /**
   * Every id names an existing row, else `VALIDATION_FAILED` with `NOT_FOUND` on `field`. With a
   * purpose, the row must also meet its rules (`OUT_OF_RANGE` on `field`). Duplicate ids are fine.
   */
  async assertUsable(
    ids: readonly string[],
    options: AssertUsableOptions = {},
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    const field = options.field ?? 'mediaIds';
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return;
    }
    if (unique.some((id) => !UUID.test(id))) {
      throw notFoundError(field);
    }
    const rows: { id: string; bytes: number; width: number; height: number }[] =
      await manager.query(SELECT_FACTS_SQL, [unique]);
    const found = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
    if (unique.some((id) => !found.has(id.toLowerCase()))) {
      throw notFoundError(field);
    }
    const { purpose } = options;
    if (purpose !== undefined && rows.some((row) => purposeViolation(purpose, row) !== null)) {
      throw new ApiError('VALIDATION_FAILED', {
        errors: [{ field, code: 'OUT_OF_RANGE', message: 'does not meet the image rules' }],
      });
    }
  }

  /**
   * Writes `alt_text` of one row in the caller's transaction (trimmed, blank as `null`, at most 200
   * code points: `TOO_LONG` on `alt`). `alt` belongs to the shared row, so every place that uses the
   * image changes (brief B18). A missing row is `NOT_FOUND` on `mediaId`.
   */
  async setAlt(manager: EntityManager, mediaId: string, alt: string | null): Promise<void> {
    const value = normalizeAlt(alt);
    if (!UUID.test(mediaId)) {
      throw notFoundError('mediaId');
    }
    // TypeORM's Postgres runner answers an UPDATE with `[rows, rowCount]`.
    const [, updated]: [unknown[], number] = await manager.query(UPDATE_ALT_SQL, [mediaId, value]);
    if (updated === 0) {
      throw notFoundError('mediaId');
    }
  }

  /** The image object of decision 0009 section 7: full URLs, never a key. */
  toImage(row: MediaImageRow): MediaImageView {
    const variants: MediaImageVariantsView = {
      thumb: this.storage.publicUrl(mediaVariantKey(row.storageKey, 'thumb')),
      medium: this.storage.publicUrl(mediaVariantKey(row.storageKey, 'medium')),
      large: this.storage.publicUrl(mediaVariantKey(row.storageKey, 'large')),
    };
    return {
      id: row.id,
      url: variants.large,
      variants,
      blurhash: row.blurhash,
      alt: row.altText,
      width: row.width,
      height: row.height,
    };
  }

  /**
   * Read-only, for the cleanup job of A12-T2: rows that nothing in `MEDIA_REFERENCE_CHECKS`
   * references and whose `created_at` is older than `olderThanDays` (decision 0009 section 8).
   */
  async findOrphans(olderThanDays: number): Promise<OrphanMedia[]> {
    if (!Number.isInteger(olderThanDays) || olderThanDays < 1) {
      throw new Error('findOrphans: olderThanDays must be a positive integer');
    }
    const cutoff = new Date(this.clock.now().getTime() - olderThanDays * DAY_MS);
    const rows: { id: string; storage_key: string; created_at: Date }[] =
      await this.dataSource.query(SELECT_ORPHANS_SQL, [cutoff]);
    return rows.map((row) => ({
      id: row.id,
      storageKey: row.storage_key,
      createdAt: row.created_at,
    }));
  }

  // -------------------------------------------------------------------------------------------

  private async findBySha256(sha256: string): Promise<MediaImageRow | null> {
    const rows: MediaSqlRow[] = await this.dataSource.query(SELECT_BY_SHA256_SQL, [sha256]);
    return rows[0] === undefined ? null : toRow(rows[0]);
  }

  private async probe(
    bytes: Buffer,
    type: ProbedImage['type'],
    purpose: MediaPurpose,
  ): Promise<ProbedImage> {
    try {
      return await probeImage(bytes, type);
    } catch (error) {
      throw this.imageError(error, { bytes: bytes.byteLength, type, purpose });
    }
  }

  /** Decoding and encoding, queued so that one image is processed at a time. */
  private process(
    bytes: Buffer,
    type: ProbedImage['type'],
    purpose: MediaPurpose,
  ): Promise<ProcessedImage> {
    const run = this.processing.then(() => processImage(bytes));
    this.processing = run.catch(() => undefined);
    return run.catch((error: unknown) => {
      throw this.imageError(error, { bytes: bytes.byteLength, type, purpose });
    });
  }

  private imageError(
    error: unknown,
    meta: { bytes: number; type: string; purpose: MediaPurpose },
  ): unknown {
    if (error instanceof ImagePixelLimitError) {
      this.logUpload('warn', meta, 'image over the pixel limit');
      return new ApiError('TOO_LARGE', { detail: 'The image has too many pixels.' });
    }
    if (error instanceof ImageDecodeError) {
      this.logUpload('warn', meta, 'image cannot be decoded');
      return new ApiError('UNSUPPORTED_TYPE', { detail: 'Upload a JPEG, PNG or WebP image.' });
    }
    return error;
  }

  /** Writes the four variants; on a failure deletes what was written (best effort) and rethrows. */
  private async writeObjects(storageKey: string, processed: ProcessedImage): Promise<void> {
    try {
      for (const variant of MEDIA_VARIANTS) {
        await this.storage.put({
          bucket: 'MEDIA',
          key: mediaVariantKey(storageKey, variant),
          body: processed.variants[variant],
          contentType: VARIANT_CONTENT_TYPE,
          cacheControl: VARIANT_CACHE_CONTROL,
        });
      }
    } catch (error) {
      await this.deleteObjects(storageKey);
      throw error;
    }
  }

  /** Best effort: a failure is logged (without the key) and left to the cleanup job. */
  private async deleteObjects(storageKey: string): Promise<void> {
    try {
      await this.storage.delete('MEDIA', mediaObjectKeys(storageKey));
    } catch {
      this.logger.warn(
        { objects: MEDIA_VARIANTS.length },
        'media objects left after a failed upload',
      );
    }
  }

  private logUpload(
    level: 'info' | 'warn',
    meta: { bytes: number; type: string | null; purpose: MediaPurpose },
    message: string,
  ): void {
    this.logger[level](meta, message);
  }
}
