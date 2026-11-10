import { randomBytes, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LoggingModule } from '../../src/common/logging/logging.module.js';
import { AppConfigModule } from '../../src/config/config.module.js';
import { readEnvironment } from '../../src/config/env-file.js';
import { createEphemeralAuthEnvironment } from '../../src/config/ephemeral-auth-environment.js';
import { loadConfig } from '../../src/config/load-config.js';
import { productionGuardViolations } from '../../src/config/production-guard.js';
import { MediaModule } from '../../src/modules/media/media.module.js';
import { STORAGE_PORT, StorageError } from '../../src/modules/media/ports/storage.port.js';
import type { StorageBucket, StoragePort } from '../../src/modules/media/ports/storage.port.js';
import { ROOT_ENV_FILE } from '../support/test-database.js';

// A6-T2: `StoragePort` through the real `MediaModule` wiring (S3 adapter, decision 0009 section 8)
// against the S3 emulator of the dev stack (SeaweedFS, Docker repository `versions.env`). No mock.
// The dev stack must be running: `pnpm dev:infra`. The emulator settings come from the root `.env`
// (`pnpm env:sync`). Every object lives under a per-run prefix and is deleted in `afterAll`.

const env = readEnvironment(ROOT_ENV_FILE, process.env);

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`storage-s3: ${name} is not set (run pnpm env:sync)`);
  }
  return value;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe('StoragePort over S3 to the emulator', () => {
  const prefix = `it-storage-s3/${randomUUID()}`;
  const written: { readonly bucket: StorageBucket; readonly key: string }[] = [];
  let moduleRef: TestingModule | undefined;
  let storage: StoragePort;

  /** Writes one object and records it for the clean-up. */
  async function put(
    bucket: StorageBucket,
    key: string,
    body: Uint8Array,
    contentType = 'application/octet-stream',
    cacheControl?: string,
  ): Promise<void> {
    written.push({ bucket, key });
    await storage.put({
      bucket,
      key,
      body,
      contentType,
      ...(cacheControl === undefined ? {} : { cacheControl }),
    });
  }

  beforeAll(async () => {
    const config = loadConfig(
      {
        APP_ENV: 'test',
        // Never connected: the spec imports no database module.
        DATABASE_URL_APP: 'postgres://storage_spec@127.0.0.1:1/unused',
        LOG_LEVEL: 'warn',
        MAIL_SMTP_HOST: '127.0.0.1',
        MAIL_SMTP_PORT: '1',
        STORAGE_S3_ENDPOINT: required('STORAGE_S3_ENDPOINT'),
        STORAGE_S3_ACCESS_KEY: required('STORAGE_S3_ACCESS_KEY'),
        STORAGE_S3_SECRET_KEY: required('STORAGE_S3_SECRET_KEY'),
        STORAGE_S3_BUCKET_MEDIA: required('STORAGE_S3_BUCKET_MEDIA'),
        STORAGE_S3_BUCKET_PRIVATE: required('STORAGE_S3_BUCKET_PRIVATE'),
        STORAGE_S3_FORCE_PATH_STYLE: env['STORAGE_S3_FORCE_PATH_STYLE'],
        STORAGE_S3_REGION: env['STORAGE_S3_REGION'],
        ...createEphemeralAuthEnvironment('kd-storage-spec-'),
      },
      'server',
    );
    // `test` accepts only the emulator kind (decision 0005 section 5).
    expect(productionGuardViolations(config)).toEqual([]);

    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule.forRoot(config), LoggingModule, MediaModule],
    }).compile();
    storage = moduleRef.get<StoragePort>(STORAGE_PORT);

    // Fail, never skip, when the dev stack is down or the buckets are missing.
    const reachable = await storage.exists('MEDIA', `${prefix}/probe`).then(
      () => true,
      () => false,
    );
    if (!reachable) {
      throw new Error(
        'storage-s3: the S3 emulator is not reachable at STORAGE_S3_ENDPOINT (or the media bucket is missing); start the dev stack with pnpm dev:infra',
      );
    }
  });

  afterAll(async () => {
    if (moduleRef !== undefined) {
      for (const bucket of ['MEDIA', 'PRIVATE'] as const) {
        const keys = written.filter((entry) => entry.bucket === bucket).map(({ key }) => key);
        await storage.delete(bucket, keys);
      }
    }
    await moduleRef?.close();
  });

  it('writes an object and reads back the same bytes, content type and Cache-Control', async () => {
    const key = `${prefix}/media/thumb.webp`;
    const body = randomBytes(64 * 1024);

    await put('MEDIA', key, body, 'image/webp', IMMUTABLE);
    const object = await storage.get('MEDIA', key);

    expect((await readAll(object.body)).equals(body)).toBe(true);
    expect(object.contentType).toBe('image/webp');
    expect(object.cacheControl).toBe(IMMUTABLE);
  });

  it('answers exists true for a written key and false for another', async () => {
    const key = `${prefix}/exists/present.bin`;
    await put('MEDIA', key, randomBytes(16));

    expect(await storage.exists('MEDIA', key)).toBe(true);
    expect(await storage.exists('MEDIA', `${prefix}/exists/absent.bin`)).toBe(false);
  });

  it('deletes idempotently: twice, and a key that never existed', async () => {
    const key = `${prefix}/delete/once.bin`;
    await put('MEDIA', key, randomBytes(16));

    await storage.delete('MEDIA', [key]);
    expect(await storage.exists('MEDIA', key)).toBe(false);
    await expect(storage.delete('MEDIA', [key])).resolves.toBeUndefined();
    await expect(
      storage.delete('MEDIA', [`${prefix}/delete/never-written.bin`]),
    ).resolves.toBeUndefined();
  });

  it('round-trips a key with spaces, Vietnamese letters and a "+"', async () => {
    const key = `${prefix}/tên món/Phở bò + quẩy đặc biệt.bin`;
    const body = randomBytes(256);

    await put('MEDIA', key, body);

    expect(await storage.exists('MEDIA', key)).toBe(true);
    expect((await readAll((await storage.get('MEDIA', key)).body)).equals(body)).toBe(true);
    // The "+" is a literal plus, not a space: the space variant does not exist.
    expect(await storage.exists('MEDIA', key.replace('+', ' '))).toBe(false);
  });

  it('keeps the PRIVATE bucket separate from MEDIA', async () => {
    const key = `${prefix}/separate/export.bin`;
    await put('PRIVATE', key, randomBytes(32));

    expect(await storage.exists('PRIVATE', key)).toBe(true);
    expect(await storage.exists('MEDIA', key)).toBe(false);
  });

  it('answers get on a missing key with StorageError NOT_FOUND', async () => {
    const error = await storage
      .get('MEDIA', `${prefix}/missing.bin`)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ operation: 'get', bucket: 'MEDIA', reason: 'NOT_FOUND' });
  });
});
