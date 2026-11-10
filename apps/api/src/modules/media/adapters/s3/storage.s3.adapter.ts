import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { PinoLogger } from 'nestjs-pino';

import type { AdapterKind } from '../../../../config/adapter-kind.js';
import type { S3Settings } from '../../../../config/load-config.js';
import { StorageError } from '../../ports/storage.port.js';
import type {
  StorageAdapter,
  StorageBucket,
  StorageOperation,
  StoragePutRequest,
  StoredObject,
} from '../../ports/storage.port.js';
import { buildS3ClientOptions, storageAdapterKind } from './build-s3-client-options.js';

/** The logger method the adapter uses (`PinoLogger` in the app, a fake in the specs). */
export type StorageLogger = Pick<PinoLogger, 'warn'>;

/** What the adapter needs from an `S3Client`, so a spec can pass a fake. */
export interface S3Sender {
  send: S3Client['send'];
}

/** The fields of an SDK error the adapter reads; nothing else of it is kept. */
interface SdkErrorShape {
  readonly name?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: unknown };
}

function isNotFound(error: unknown): boolean {
  const { name, $metadata } = (error ?? {}) as SdkErrorShape;
  return name === 'NoSuchKey' || name === 'NotFound' || $metadata?.httpStatusCode === 404;
}

/**
 * `StoragePort` over the S3 API (decision 0009 section 8): AWS S3 in `demo` and `prod`, the Docker
 * emulator in `dev` and `test`. Logs the operation, the bucket role and the provider's error code
 * only: never a key, a bucket name, the endpoint, a credential or an object URL.
 */
export class S3StorageAdapter implements StorageAdapter {
  constructor(
    private readonly client: S3Sender,
    private readonly buckets: S3Settings['buckets'],
    readonly kind: AdapterKind,
    private readonly logger: StorageLogger,
  ) {}

  /** Creates the client; the SDK connects and resolves credentials only on the first call. */
  static create(s3: S3Settings, logger: StorageLogger): S3StorageAdapter {
    return new S3StorageAdapter(
      new S3Client(buildS3ClientOptions(s3)),
      s3.buckets,
      storageAdapterKind(s3),
      logger,
    );
  }

  async put({ bucket, key, body, contentType, cacheControl }: StoragePutRequest): Promise<void> {
    await this.call('put', bucket, () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName(bucket),
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: contentType,
          ...(cacheControl === undefined ? {} : { CacheControl: cacheControl }),
        }),
      ),
    );
  }

  async get(bucket: StorageBucket, key: string): Promise<StoredObject> {
    const output = await this.call('get', bucket, () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key })),
    );
    // In Node the SDK returns the response body as a `Readable` (an `IncomingMessage`).
    if (!(output.Body instanceof Readable)) {
      throw this.failure('get', bucket, 'FAILED', 'NoBody');
    }
    return {
      body: output.Body,
      contentType: output.ContentType ?? null,
      cacheControl: output.CacheControl ?? null,
    };
  }

  /** One `DeleteObject` per key: S3 answers 204 for a missing key, and `DeleteObjects` always
   * sends a checksum header (decision 0009 section 8). */
  async delete(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      await this.call('delete', bucket, () =>
        this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key })),
      );
    }
  }

  async exists(bucket: StorageBucket, key: string): Promise<boolean> {
    try {
      await this.call('exists', bucket, () =>
        this.client.send(new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key })),
      );
      return true;
    } catch (error) {
      if (error instanceof StorageError && error.reason === 'NOT_FOUND') {
        return false;
      }
      throw error;
    }
  }

  private bucketName(bucket: StorageBucket): string {
    return bucket === 'MEDIA' ? this.buckets.media : this.buckets.private;
  }

  /** Runs one SDK call and replaces any failure with a `StorageError`. */
  private async call<T>(
    operation: StorageOperation,
    bucket: StorageBucket,
    send: () => Promise<T>,
  ): Promise<T> {
    try {
      return await send();
    } catch (error) {
      const notFound = isNotFound(error);
      const failure = this.failure(
        operation,
        bucket,
        notFound ? 'NOT_FOUND' : 'FAILED',
        (error as SdkErrorShape | undefined)?.name,
      );
      // A missing object is an answer for `exists` and a 404 for callers, not an incident.
      if (!notFound) {
        this.logger.warn(
          { operation, bucket, errorCode: failure.code },
          'storage operation failed',
        );
      }
      throw failure;
    }
  }

  private failure(
    operation: StorageOperation,
    bucket: StorageBucket,
    reason: 'NOT_FOUND' | 'FAILED',
    code: unknown,
  ): StorageError {
    return new StorageError(operation, bucket, reason, code);
  }
}
