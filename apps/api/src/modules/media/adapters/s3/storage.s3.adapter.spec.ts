import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import { StorageError } from '../../ports/storage.port.js';
import { S3StorageAdapter } from './storage.s3.adapter.js';
import type { S3Sender } from './storage.s3.adapter.js';

// Decision 0009 section 8 (A6-T2): the adapter against a fake client. No network; the real
// round trip is `test/integration/storage-s3.int-spec.ts` against the Docker emulator.

const BUCKETS = Object.freeze({ media: 'leak-check-media', private: 'leak-check-private' });

/** An SDK-like error: a name, a status and text that must never be logged or kept. */
function sdkError(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(`leak-check ${name} at http://leak-check.invalid:9020/key`), {
    name,
    $metadata: { httpStatusCode },
  });
}

interface Harness {
  readonly adapter: S3StorageAdapter;
  readonly commands: unknown[];
  readonly warnings: unknown[];
}

function harness(answer: (command: unknown) => Promise<unknown>): Harness {
  const commands: unknown[] = [];
  const warnings: unknown[] = [];
  const client = {
    send: (command: unknown) => {
      commands.push(command);
      return answer(command);
    },
  } as unknown as S3Sender;
  const logger = { warn: (...args: unknown[]) => void warnings.push(args) };
  return { adapter: new S3StorageAdapter(client, BUCKETS, 'emulator', logger), commands, warnings };
}

describe('S3StorageAdapter', () => {
  it('puts with the bucket of the role, the content type, the length and Cache-Control', async () => {
    const { adapter, commands } = harness(() => Promise.resolve({}));
    const body = new Uint8Array([1, 2, 3]);

    await adapter.put({
      bucket: 'MEDIA',
      key: 'media/a.webp',
      body,
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect((commands[0] as PutObjectCommand).input).toEqual({
      Bucket: 'leak-check-media',
      Key: 'media/a.webp',
      Body: body,
      ContentLength: 3,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('omits Cache-Control when none is given and uses the private bucket for PRIVATE', async () => {
    const { adapter, commands } = harness(() => Promise.resolve({}));

    await adapter.put({
      bucket: 'PRIVATE',
      key: 'exports/a.xlsx',
      body: new Uint8Array(1),
      contentType: 'application/octet-stream',
    });

    const input = (commands[0] as PutObjectCommand).input;
    expect(input.Bucket).toBe('leak-check-private');
    expect(input).not.toHaveProperty('CacheControl');
  });

  it('returns the body stream with its content type and Cache-Control', async () => {
    const body = Readable.from([Buffer.from('abc')]);
    const { adapter, commands } = harness(() =>
      Promise.resolve({ Body: body, ContentType: 'image/webp', CacheControl: 'no-store' }),
    );

    const object = await adapter.get('MEDIA', 'media/a.webp');

    expect(commands[0]).toBeInstanceOf(GetObjectCommand);
    expect(object).toEqual({ body, contentType: 'image/webp', cacheControl: 'no-store' });
  });

  it('maps a missing object on get to NOT_FOUND without a warning', async () => {
    const { adapter, warnings } = harness(() => Promise.reject(sdkError('NoSuchKey', 404)));

    const error = await adapter
      .get('MEDIA', 'media/missing.webp')
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ operation: 'get', bucket: 'MEDIA', reason: 'NOT_FOUND' });
    expect(warnings).toEqual([]);
  });

  it('answers exists from HeadObject: true, then false on 404', async () => {
    let found = true;
    const { adapter, commands } = harness(() =>
      found ? Promise.resolve({}) : Promise.reject(sdkError('NotFound', 404)),
    );

    expect(await adapter.exists('MEDIA', 'media/a.webp')).toBe(true);
    found = false;
    expect(await adapter.exists('MEDIA', 'media/a.webp')).toBe(false);
    expect(commands.every((command) => command instanceof HeadObjectCommand)).toBe(true);
  });

  it('deletes one key per DeleteObject call', async () => {
    const { adapter, commands } = harness(() => Promise.resolve({}));

    await adapter.delete('PRIVATE', ['exports/a', 'exports/b']);

    expect(commands.map((command) => (command as DeleteObjectCommand).input)).toEqual([
      { Bucket: 'leak-check-private', Key: 'exports/a' },
      { Bucket: 'leak-check-private', Key: 'exports/b' },
    ]);
    expect(commands.every((command) => command instanceof DeleteObjectCommand)).toBe(true);
  });

  it('replaces a provider failure with a StorageError and logs no key, bucket name or endpoint', async () => {
    const { adapter, warnings } = harness(() => Promise.reject(sdkError('AccessDenied', 403)));

    const error = await adapter
      .exists('PRIVATE', 'exports/leak-check.xlsx')
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({
      operation: 'exists',
      bucket: 'PRIVATE',
      reason: 'FAILED',
      code: 'AccessDenied',
    });
    expect((error as Error).message).not.toMatch(/leak.check/);
    expect((error as Error).cause).toBeUndefined();
    expect(warnings).toEqual([
      [
        { operation: 'exists', bucket: 'PRIVATE', errorCode: 'AccessDenied' },
        'storage operation failed',
      ],
    ]);
    expect(JSON.stringify(warnings)).not.toMatch(/leak.check/);
  });
});
