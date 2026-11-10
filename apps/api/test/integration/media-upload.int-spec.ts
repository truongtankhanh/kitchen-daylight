import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';

import { isProblemDetails } from '@kd/contracts';
import type { ProblemDetails } from '@kd/contracts';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { readEnvironment } from '../../src/config/env-file.js';
import { createEphemeralAuthEnvironment } from '../../src/config/ephemeral-auth-environment.js';
import { loadConfig } from '../../src/config/load-config.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { mediaObjectKeys } from '../../src/modules/media/media-key.js';
import { createStoragePort } from '../../src/modules/media/media.module.js';
import { STORAGE_PORT } from '../../src/modules/media/ports/storage.port.js';
import type { StoragePort } from '../../src/modules/media/ports/storage.port.js';
import type { UserRole } from '../../src/modules/users/entities/user.entity.js';
import { createTestApp } from '../support/create-test-app.js';
import type { TestApp } from '../support/create-test-app.js';
import { ROOT_ENV_FILE } from '../support/test-database.js';
import { truncateAll } from '../support/truncate.js';

// A6-T3: `POST /api/v1/admin/uploads/images` through the real app, as `kd_app` against real
// PostgreSQL, with `STORAGE_PORT` bound to the S3 emulator of the dev stack (the root `.env`, as in
// `storage-s3.int-spec.ts`). The dev stack must be running: `pnpm dev:infra`. Images are generated
// with sharp in the spec; every object written is deleted after each test. Fictional data only.

const ADMIN_ID = '01930000-0000-7000-8000-000000006311';
const MANAGER_ID = '01930000-0000-7000-8000-000000006312';
const STAFF_ID = '01930000-0000-7000-8000-000000006313';
const SESSION_ID = '01930000-0000-7000-8000-0000000063a1';

const PATH = '/api/v1/admin/uploads/images';
/** A hostile, accented file name: it must reach neither the key nor the row. */
const HOSTILE_NAME = '../../Ảnh món phở x.jpg';

const env = readEnvironment(ROOT_ENV_FILE, process.env);

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`media-upload: ${name} is not set (run pnpm env:sync)`);
  }
  return value;
}

/** `StoragePort` on the emulator, built by the module's own factory. */
function emulatorStorage(): StoragePort {
  const publicBaseUrl = env['MEDIA_PUBLIC_BASE_URL'];
  const config = loadConfig(
    {
      APP_ENV: 'test',
      // Only the storage part of this config is used.
      DATABASE_URL_APP: 'postgres://media_spec@127.0.0.1:1/unused',
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
      ...(publicBaseUrl === undefined || publicBaseUrl === ''
        ? {}
        : { MEDIA_PUBLIC_BASE_URL: publicBaseUrl }),
      ...createEphemeralAuthEnvironment('kd-media-spec-'),
    },
    'server',
  );
  return createStoragePort(config.storage, { warn: () => undefined });
}

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A 66-byte PNG whose header claims `side` x `side` pixels: a decompression bomb by its header. */
function pngBomb(side: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(1))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A small JPEG, different for each `seed` so tests never share a `sha256`. */
function jpeg(seed: number, width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: seed % 256, g: 80, b: 160 } },
  })
    .jpeg()
    .toBuffer();
}

interface UploadedImage {
  id: string;
  url: string;
  variants: { thumb: string; medium: string; large: string };
  blurhash: string;
  alt: string | null;
  width: number;
  height: number;
  duplicate: boolean;
}

interface UploadResponse {
  status: number;
  body: unknown;
  problem: ProblemDetails | null;
}

interface UploadRequest {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
}

describe('POST /admin/uploads/images (kd_app, real PostgreSQL, S3 emulator)', () => {
  let storage: StoragePort;
  let testApp: TestApp;

  beforeAll(async () => {
    storage = emulatorStorage();
    // Fail, never skip, when the dev stack is down or the media bucket is missing.
    const reachable = await storage.exists('MEDIA', 'it-media-upload/probe').then(
      () => true,
      () => false,
    );
    if (!reachable) {
      throw new Error(
        'media-upload: the S3 emulator is not reachable at STORAGE_S3_ENDPOINT; start the dev stack with pnpm dev:infra',
      );
    }
  });

  beforeEach(async () => {
    await truncateAll();
    testApp = await createTestApp({ providers: [{ provide: STORAGE_PORT, useValue: storage }] });
    await insertUser(ADMIN_ID, 'ADMIN');
    await insertUser(MANAGER_ID, 'MANAGER');
    await insertUser(STAFF_ID, 'STAFF');
  });

  afterEach(async () => {
    // Every object of every row this test created.
    const rows: { storage_key: string }[] = await testApp.dataSource.query(
      'SELECT storage_key FROM public.media',
    );
    for (const { storage_key: storageKey } of rows) {
      await storage.delete('MEDIA', mediaObjectKeys(storageKey));
    }
    await testApp.close();
  });

  function insertUser(id: string, role: UserRole): Promise<unknown> {
    return testApp.dataSource.query(
      `INSERT INTO public.users (id, email, display_name, locale, role, status)
       VALUES ($1, $2, 'Người dùng mẫu', 'vi', $3, 'ACTIVE')`,
      [id, `fixture-media-${id.slice(-4)}@kd.example`, role],
    );
  }

  async function bearer(userId: string, role: UserRole): Promise<Record<string, string>> {
    const { token } = await testApp.app
      .get(AccessTokenService)
      .sign({ userId, role, sessionId: SESSION_ID });
    return { authorization: `Bearer ${token}` };
  }

  async function post(request: UploadRequest): Promise<UploadResponse> {
    const form = new FormData();
    form.append(
      'file',
      // A copy on a plain `ArrayBuffer`, the only `BlobPart` buffer the DOM types accept.
      new Blob([Uint8Array.from(request.bytes)], { type: request.mimeType ?? 'image/jpeg' }),
      request.fileName ?? HOSTILE_NAME,
    );
    for (const [name, value] of Object.entries(request.fields ?? {})) {
      form.append(name, value);
    }
    const response = await fetch(new URL(PATH, testApp.baseUrl), {
      method: 'POST',
      headers: request.headers,
      body: form,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    const body: unknown = text === '' ? null : JSON.parse(text);
    const isProblem = (response.headers.get('content-type') ?? '').startsWith(
      'application/problem+json',
    );
    return {
      status: response.status,
      body,
      problem: isProblem && isProblemDetails(body) ? body : null,
    };
  }

  async function asManager(request: UploadRequest): Promise<UploadResponse> {
    return post({ ...request, headers: await bearer(MANAGER_ID, 'MANAGER') });
  }

  async function asAdmin(request: UploadRequest): Promise<UploadResponse> {
    return post({ ...request, headers: await bearer(ADMIN_ID, 'ADMIN') });
  }

  function mediaRows(): Promise<
    {
      id: string;
      storage_key: string;
      content_type: string;
      bytes: number;
      width: number;
      height: number;
      alt_text: string | null;
      uploaded_by: string;
    }[]
  > {
    return testApp.dataSource.query(
      `SELECT id::text AS id, storage_key, content_type, bytes, width, height, alt_text,
              uploaded_by::text AS uploaded_by
         FROM public.media ORDER BY created_at, id`,
    );
  }

  it('answers 201 with the image object, then 200 duplicate for the same bytes', async () => {
    const bytes = await jpeg(1);

    const first = await asManager({ bytes, fields: { alt: 'Phở bò tái' } });
    expect(first.status).toBe(201);
    const image = first.body as UploadedImage;
    expect(image).toMatchObject({
      alt: 'Phở bò tái',
      width: 64,
      height: 48,
      duplicate: false,
    });
    expect(image.url).toBe(image.variants.large);
    expect(Object.keys(image).sort()).toEqual(
      ['alt', 'blurhash', 'duplicate', 'height', 'id', 'url', 'variants', 'width'].sort(),
    );

    const second = await asAdmin({ bytes, fields: { alt: 'Một tên khác' } });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ...image, duplicate: true });

    const rows = await mediaRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: image.id,
      content_type: 'image/jpeg',
      bytes: bytes.byteLength,
      alt_text: 'Phở bò tái',
      uploaded_by: MANAGER_ID,
    });
  });

  it('ends two parallel uploads of the same bytes with one row', async () => {
    const bytes = await jpeg(2);
    const headers = await bearer(MANAGER_ID, 'MANAGER');

    const responses = await Promise.all([post({ bytes, headers }), post({ bytes, headers })]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    const [a, b] = responses.map(({ body }) => body as UploadedImage);
    expect(a?.id).toBe(b?.id);
    expect(await mediaRows()).toHaveLength(1);
  });

  it('never puts the uploaded file name in the key or the row', async () => {
    const response = await asManager({ bytes: await jpeg(3), fileName: HOSTILE_NAME });
    expect(response.status).toBe(201);

    const [row] = await mediaRows();
    expect(row?.storage_key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/u);
    expect(row?.storage_key.endsWith(`/${(response.body as UploadedImage).id}`)).toBe(true);
    const stored = JSON.stringify(row) + JSON.stringify(response.body);
    for (const fragment of ['..', 'Ảnh', 'phở', 'x.jpg']) {
      expect(stored).not.toContain(fragment);
    }
  });

  // The emulator bucket has no anonymous read yet (Docker repository follow-up of decision 0009
  // section 6), so an unsigned GET of the public URL is 403. The spec checks that each URL is the
  // public URL of its object and reads the object through the signed `StoragePort` instead; the
  // anonymous GET comes back here once `kd-dev-media` allows public read.
  it('writes every variant as an immutable WebP behind its public URL', async () => {
    const response = await asManager({ bytes: await jpeg(4, 900, 600) });
    expect(response.status).toBe(201);
    const image = response.body as UploadedImage;
    const [row] = await mediaRows();
    const storageKey = row?.storage_key ?? '';

    for (const [variant, url] of Object.entries(image.variants)) {
      const key = `${storageKey}/${variant}.webp`;
      expect(url).toBe(storage.publicUrl(key));
      const object = await storage.get('MEDIA', key);
      expect(object.contentType).toBe('image/webp');
      expect(object.cacheControl).toBe('public, max-age=31536000, immutable');
      const metadata = await sharp(await readAll(object.body)).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
    }
    expect(await storage.exists('MEDIA', `${storageKey}/master.webp`)).toBe(true);
  });

  it('answers 413 TOO_LARGE over 10 MB', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(10 * 1024 * 1024)]);

    const response = await asManager({ bytes });

    expect(response.status).toBe(413);
    expect(response.problem?.code).toBe('TOO_LARGE');
    expect(await mediaRows()).toHaveLength(0);
  });

  it('answers 413 TOO_LARGE over the pixel limit', async () => {
    const response = await asManager({ bytes: pngBomb(10_000), mimeType: 'image/png' });

    expect(response.status).toBe(413);
    expect(response.problem?.code).toBe('TOO_LARGE');
  });

  it('answers 415 UNSUPPORTED_TYPE for SVG', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300"/></svg>',
    );

    const response = await asManager({
      bytes: svg,
      fileName: 'logo.svg',
      mimeType: 'image/svg+xml',
    });

    expect(response.status).toBe(415);
    expect(response.problem?.code).toBe('UNSUPPORTED_TYPE');
  });

  it('answers 415 UNSUPPORTED_TYPE for a text file renamed .jpg', async () => {
    const response = await asManager({
      bytes: Buffer.from('Thực đơn hôm nay: phở, bún chả, cơm tấm\n'),
      fileName: 'thuc-don.jpg',
      mimeType: 'image/jpeg',
    });

    expect(response.status).toBe(415);
    expect(response.problem?.code).toBe('UNSUPPORTED_TYPE');
    expect(await mediaRows()).toHaveLength(0);
  });

  it('answers VALIDATION_FAILED on file for a logo under 256 px', async () => {
    const response = await asAdmin({ bytes: await jpeg(5, 300, 200), fields: { purpose: 'LOGO' } });

    expect(response.status).toBe(400);
    expect(response.problem?.code).toBe('VALIDATION_FAILED');
    expect(response.problem?.errors?.map(({ field, code }) => ({ field, code }))).toEqual([
      { field: 'file', code: 'OUT_OF_RANGE' },
    ]);
  });

  it('accepts a logo of at least 256 px from an admin', async () => {
    const response = await asAdmin({ bytes: await jpeg(6, 512, 256), fields: { purpose: 'LOGO' } });

    expect(response.status).toBe(201);
  });

  it('answers VALIDATION_FAILED with TOO_LONG on alt over 200 characters', async () => {
    const response = await asManager({ bytes: await jpeg(7), fields: { alt: 'ả'.repeat(201) } });

    expect(response.status).toBe(400);
    expect(response.problem?.errors?.map(({ field, code }) => ({ field, code }))).toEqual([
      { field: 'alt', code: 'TOO_LONG' },
    ]);
  });

  it('answers VALIDATION_FAILED with REQUIRED on file when no file is sent', async () => {
    const response = await fetch(new URL(PATH, testApp.baseUrl), {
      method: 'POST',
      headers: await bearer(MANAGER_ID, 'MANAGER'),
      body: (() => {
        const form = new FormData();
        form.append('alt', 'Không có tệp');
        return form;
      })(),
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(400);
    expect(isProblemDetails(body) ? body.errors : undefined).toEqual([
      { field: 'file', code: 'REQUIRED', message: 'is required' },
    ]);
  });

  it('answers 403 FORBIDDEN to STAFF', async () => {
    const response = await post({ bytes: await jpeg(8), headers: await bearer(STAFF_ID, 'STAFF') });

    expect(response.status).toBe(403);
    expect(response.problem?.code).toBe('FORBIDDEN');
  });

  it('answers 403 FORBIDDEN to a MANAGER uploading a LOGO', async () => {
    const response = await asManager({
      bytes: await jpeg(9, 512, 512),
      fields: { purpose: 'LOGO' },
    });

    expect(response.status).toBe(403);
    expect(response.problem?.code).toBe('FORBIDDEN');
    expect(await mediaRows()).toHaveLength(0);
  });

  it('answers 401 UNAUTHENTICATED without a token', async () => {
    const response = await post({ bytes: await jpeg(10) });

    expect(response.status).toBe(401);
    expect(response.problem?.code).toBe('UNAUTHENTICATED');
  });

  it('keeps the CHECKs and the unique sha256 in the table', async () => {
    const response = await asManager({ bytes: await jpeg(11) });
    expect(response.status).toBe(201);
    const [row] = await mediaRows();

    // A second row with the same sha256 is refused by the unique constraint.
    await expect(
      testApp.dataSource.query(
        `INSERT INTO public.media
           (storage_key, content_type, width, height, bytes, sha256, blurhash)
         SELECT 'media/2026/11/01930000-0000-7000-8000-0000000063ff', content_type, width, height,
                bytes, sha256, blurhash
           FROM public.media WHERE id = $1`,
        [row?.id],
      ),
    ).rejects.toThrow(/media_sha256_key/u);
    await expect(
      testApp.dataSource.query('UPDATE public.media SET alt_text = $2 WHERE id = $1', [
        row?.id,
        'x'.repeat(201),
      ]),
    ).rejects.toThrow(/media_alt_text_length/u);
  });
});
