import sharp from 'sharp';
import type { DataSource, EntityManager } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { RequestUser } from '../../common/auth/request-user.js';
import { ApiError } from '../../common/errors/api-error.js';
import { FixedClock } from '../../common/time/testing.js';
import { MEDIA_STORAGE_KEY } from './media-key.js';
import { MediaService } from './media.service.js';
import type { MediaLogger, UploadImageResult } from './media.service.js';
import type { StorageBucket, StoragePort, StoragePutRequest } from './ports/storage.port.js';

// MediaService with fakes for the database, the storage and the logger: the upload order, the
// duplicate answers, the clean-up of written objects, the role of a logo upload and what is logged.
// The SQL itself is covered by `test/integration/media-upload.int-spec.ts`.

const ADMIN: RequestUser = {
  id: '01930000-0000-7000-8000-000000006301',
  role: 'ADMIN',
  sessionId: 's',
};
const MANAGER: RequestUser = {
  ...ADMIN,
  id: '01930000-0000-7000-8000-000000006302',
  role: 'MANAGER',
};
const NOW = '2026-11-10T03:00:00.000Z';
const PUBLIC_BASE = 'https://media.kitchendaylight.example';

interface StoredRow {
  id: string;
  storage_key: string;
  blurhash: string;
  alt_text: string | null;
  width: number;
  height: number;
  sha256: string;
  bytes: number;
}

/** A `DataSource` that understands the four statements of the service. */
class FakeDatabase {
  readonly rows: StoredRow[] = [];
  insertError: Error | null = null;
  /** Rows another upload "commits" just before this insert runs (the parallel-upload race). */
  racer: StoredRow | null = null;
  readonly statements: string[] = [];

  query = (sql: string, parameters: unknown[] = []): Promise<unknown> => {
    this.statements.push(sql.split(/\s+/u).slice(0, 3).join(' '));
    if (sql.includes('WHERE sha256 = $1')) {
      return Promise.resolve(this.rows.filter((row) => row.sha256 === parameters[0]));
    }
    if (sql.startsWith('INSERT INTO public.media')) {
      if (this.insertError !== null) {
        return Promise.reject(this.insertError);
      }
      if (this.racer !== null) {
        this.rows.push(this.racer);
        this.racer = null;
      }
      const [id, storageKey, , width, height, bytes, sha256, blurhash, alt] = parameters as [
        string,
        string,
        string,
        number,
        number,
        number,
        string,
        string,
        string | null,
      ];
      if (this.rows.some((row) => row.sha256 === sha256)) {
        return Promise.resolve([]);
      }
      const row: StoredRow = {
        id,
        storage_key: storageKey,
        blurhash,
        alt_text: alt,
        width,
        height,
        sha256,
        bytes,
      };
      this.rows.push(row);
      return Promise.resolve([row]);
    }
    if (sql.includes('WHERE id = ANY')) {
      const ids = parameters[0] as string[];
      return Promise.resolve(this.rows.filter((row) => ids.includes(row.id)));
    }
    if (sql.startsWith('UPDATE public.media SET alt_text')) {
      const row = this.rows.find((candidate) => candidate.id === parameters[0]);
      if (row !== undefined) {
        row.alt_text = parameters[1] as string | null;
      }
      return Promise.resolve([[], row === undefined ? 0 : 1]);
    }
    return Promise.reject(new Error(`unexpected SQL: ${sql}`));
  };

  get manager(): EntityManager {
    return { query: this.query } as unknown as EntityManager;
  }
}

class FakeStorage implements StoragePort {
  readonly objects = new Map<string, StoragePutRequest>();
  readonly deleted: string[] = [];
  failPutAfter = Number.POSITIVE_INFINITY;

  put(request: StoragePutRequest): Promise<void> {
    if (this.objects.size >= this.failPutAfter) {
      return Promise.reject(new Error('storage put failed'));
    }
    this.objects.set(request.key, request);
    return Promise.resolve();
  }

  get(): never {
    throw new Error('not used');
  }

  delete(_bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.objects.delete(key);
      this.deleted.push(key);
    }
    return Promise.resolve();
  }

  exists(_bucket: StorageBucket, key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  publicUrl(key: string): string {
    return `${PUBLIC_BASE}/${key}`;
  }
}

class FakeLogger implements MediaLogger {
  readonly entries: unknown[][] = [];
  info = (...args: unknown[]): void => {
    this.entries.push(args);
  };
  warn = (...args: unknown[]): void => {
    this.entries.push(args);
  };
}

async function caught(work: Promise<unknown>): Promise<ApiError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an ApiError');
}

describe('MediaService', () => {
  let photo: Buffer;
  let logo: Buffer;
  let database: FakeDatabase;
  let storage: FakeStorage;
  let logger: FakeLogger;
  let service: MediaService;

  beforeAll(async () => {
    photo = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#e67e22' } })
      .jpeg()
      .toBuffer();
    logo = await sharp({ create: { width: 300, height: 300, channels: 4, background: '#2c3e50' } })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    database = new FakeDatabase();
    storage = new FakeStorage();
    logger = new FakeLogger();
    service = new MediaService(
      database as unknown as DataSource,
      storage,
      new FixedClock(NOW),
      logger as unknown as MediaLogger,
    );
  });

  function upload(
    actor: RequestUser,
    bytes: Buffer,
    extra: { purpose?: 'PHOTO' | 'LOGO'; alt?: string } = {},
  ): Promise<UploadImageResult> {
    return service.upload(actor, { bytes, purpose: extra.purpose ?? 'PHOTO', alt: extra.alt });
  }

  it('stores four WebP objects under a key built from the id and answers created', async () => {
    const { image, created } = await upload(MANAGER, photo, { alt: '  Bánh xèo  ' });

    expect(created).toBe(true);
    expect(image.duplicate).toBe(false);
    expect(image.alt).toBe('Bánh xèo');
    expect([image.width, image.height]).toEqual([48, 32]);
    const keys = [...storage.objects.keys()];
    expect(keys).toHaveLength(4);
    const storageKey = database.rows[0]?.storage_key ?? '';
    expect(storageKey).toMatch(MEDIA_STORAGE_KEY);
    expect(storageKey.startsWith(`media/2026/11/${image.id}`)).toBe(true);
    for (const request of storage.objects.values()) {
      expect(request).toMatchObject({
        bucket: 'MEDIA',
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
    expect(image.url).toBe(`${PUBLIC_BASE}/${storageKey}/large.webp`);
    expect(image.variants).toEqual({
      thumb: `${PUBLIC_BASE}/${storageKey}/thumb.webp`,
      medium: `${PUBLIC_BASE}/${storageKey}/medium.webp`,
      large: `${PUBLIC_BASE}/${storageKey}/large.webp`,
    });
    expect(JSON.stringify(image)).not.toContain('master');
  });

  it('answers the same bytes with the existing row, unchanged, and writes nothing', async () => {
    const first = await upload(MANAGER, photo, { alt: 'Lần đầu' });
    storage.objects.clear();

    const second = await upload(ADMIN, photo, { alt: 'Lần hai' });

    expect(second.created).toBe(false);
    expect(second.image).toEqual({ ...first.image, duplicate: true });
    expect(second.image.alt).toBe('Lần đầu');
    expect(storage.objects.size).toBe(0);
  });

  it('answers a lost race with the winner and deletes its own objects', async () => {
    const winner = await upload(MANAGER, photo);
    const winnerRow = database.rows.pop() as StoredRow;
    storage.objects.clear();
    database.racer = winnerRow;

    const loser = await upload(ADMIN, photo);

    expect(loser.created).toBe(false);
    expect(loser.image).toEqual({ ...winner.image, duplicate: true });
    expect(database.rows).toHaveLength(1);
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(4);
  });

  it('deletes the written objects and rethrows when the insert fails', async () => {
    database.insertError = new Error('connection lost');

    await expect(upload(MANAGER, photo)).rejects.toThrow('connection lost');

    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(4);
    expect(database.rows).toHaveLength(0);
  });

  it('deletes what was written when a later object fails, and inserts nothing', async () => {
    storage.failPutAfter = 2;

    await expect(upload(MANAGER, photo)).rejects.toThrow('storage put failed');

    expect(storage.objects.size).toBe(0);
    expect(database.statements.some((statement) => statement.startsWith('INSERT'))).toBe(false);
  });

  it('refuses a logo from a manager with 403 before reading the file', async () => {
    const error = await caught(
      upload(MANAGER, Buffer.from('not even an image'), { purpose: 'LOGO' }),
    );

    expect(error.code).toBe('FORBIDDEN');
    expect(database.statements).toEqual([]);
  });

  it('accepts a logo from an admin', async () => {
    const { created, image } = await upload(ADMIN, logo, { purpose: 'LOGO' });

    expect(created).toBe(true);
    expect([image.width, image.height]).toEqual([300, 300]);
  });

  it('refuses a logo under 256 px with OUT_OF_RANGE on file', async () => {
    const error = await caught(upload(ADMIN, photo, { purpose: 'LOGO' }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.errors?.[0]).toMatchObject({ field: 'file', code: 'OUT_OF_RANGE' });
  });

  it('refuses a file that is not JPEG, PNG or WebP with 415', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

    expect((await caught(upload(MANAGER, svg))).code).toBe('UNSUPPORTED_TYPE');
    expect((await caught(upload(MANAGER, Buffer.alloc(0)))).code).toBe('UNSUPPORTED_TYPE');
  });

  it('refuses a JPEG signature on bytes sharp cannot read with 415', async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('plain text')]);

    expect((await caught(upload(MANAGER, fake))).code).toBe('UNSUPPORTED_TYPE');
  });

  it('refuses an alt over 200 code points with TOO_LONG before any work', async () => {
    const error = await caught(upload(MANAGER, photo, { alt: 'x'.repeat(201) }));

    expect(error.errors).toEqual([{ field: 'alt', code: 'TOO_LONG', message: 'is too long' }]);
    expect(database.statements).toEqual([]);
  });

  it('logs the size, the detected type and the purpose only', async () => {
    await upload(MANAGER, photo, { alt: 'Gỏi cuốn' });

    expect(logger.entries).toEqual([
      [{ bytes: photo.byteLength, type: 'jpeg', purpose: 'PHOTO' }, 'image uploaded'],
    ]);
  });

  describe('assertUsable', () => {
    it('passes when every id exists, duplicates included', async () => {
      const { image } = await upload(MANAGER, photo);

      await expect(service.assertUsable([image.id, image.id])).resolves.toBeUndefined();
      await expect(service.assertUsable([])).resolves.toBeUndefined();
    });

    it('names the field with NOT_FOUND for a missing or malformed id', async () => {
      const missing = await caught(
        service.assertUsable(['01930000-0000-7000-8000-0000000063ff'], { field: 'media' }),
      );
      const malformed = await caught(service.assertUsable(['../x']));

      expect(missing.errors).toEqual([
        { field: 'media', code: 'NOT_FOUND', message: 'names an image that does not exist' },
      ]);
      expect(malformed.errors?.[0]).toMatchObject({ field: 'mediaIds', code: 'NOT_FOUND' });
    });

    it('checks the purpose rules from the stored row', async () => {
      const { image } = await upload(MANAGER, photo);

      const error = await caught(
        service.assertUsable([image.id], { purpose: 'LOGO', field: 'brand.logo' }),
      );

      expect(error.errors?.[0]).toMatchObject({ field: 'brand.logo', code: 'OUT_OF_RANGE' });
    });
  });

  describe('setAlt', () => {
    it('writes the trimmed text, or null for a blank one', async () => {
      const { image } = await upload(MANAGER, photo);

      await service.setAlt(database.manager, image.id, '  Cơm tấm  ');
      expect(database.rows[0]?.alt_text).toBe('Cơm tấm');
      await service.setAlt(database.manager, image.id, ' ');
      expect(database.rows[0]?.alt_text).toBeNull();
    });

    it('refuses a missing row and a text over 200 code points', async () => {
      const missing = await caught(
        service.setAlt(database.manager, '01930000-0000-7000-8000-0000000063ff', 'x'),
      );
      const tooLong = await caught(
        service.setAlt(database.manager, '01930000-0000-7000-8000-0000000063ff', 'x'.repeat(201)),
      );

      expect(missing.errors?.[0]).toMatchObject({ field: 'mediaId', code: 'NOT_FOUND' });
      expect(tooLong.errors?.[0]).toMatchObject({ field: 'alt', code: 'TOO_LONG' });
    });
  });

  it('refuses findOrphans without a positive whole number of days', async () => {
    await expect(service.findOrphans(0)).rejects.toThrow(/positive integer/u);
    await expect(service.findOrphans(1.5)).rejects.toThrow(/positive integer/u);
  });
});
