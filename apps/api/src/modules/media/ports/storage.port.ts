import type { Readable } from 'node:stream';

import type { DeclaresAdapterKind } from '../../../config/adapter-kind.js';

// Decision 0005, section 6 and decision 0009, sections 6 and 8: a port is an interface plus an
// injection token in its owning module. Other modules inject `STORAGE_PORT`, never an adapter class.

/** Injection token of the bound `StoragePort`. */
export const STORAGE_PORT = Symbol('STORAGE_PORT');

/**
 * The bucket roles: `MEDIA` is public through the CDN, `PRIVATE` (exports) is never served
 * directly. The bucket names come from configuration.
 */
export const STORAGE_BUCKETS = ['MEDIA', 'PRIVATE'] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export interface StoragePutRequest {
  readonly bucket: StorageBucket;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  /** For example `public, max-age=31536000, immutable` on media variants (decision 0009 section 6). */
  readonly cacheControl?: string;
}

export interface StoredObject {
  /** Read it to the end or destroy it, so the connection is released. */
  readonly body: Readable;
  readonly contentType: string | null;
  readonly cacheControl: string | null;
}

export interface StoragePort {
  /** Writes one object; an existing key is replaced. */
  put(request: StoragePutRequest): Promise<void>;
  /** Reads one object; a missing key throws `StorageError` with `reason: 'NOT_FOUND'`. */
  get(bucket: StorageBucket, key: string): Promise<StoredObject>;
  /** Deletes the keys; a missing key is not an error. */
  delete(bucket: StorageBucket, keys: readonly string[]): Promise<void>;
  exists(bucket: StorageBucket, key: string): Promise<boolean>;
  /** Pure: the public URL of a `MEDIA` key under the configured base (decision 0009 section 6). */
  publicUrl(key: string): string;
}

/** What an adapter implements: the I/O half of the port, keys already checked. */
export type StorageAdapter = Omit<StoragePort, 'publicUrl'> & DeclaresAdapterKind;

/** S3 caps a key at 1024 bytes of UTF-8. */
export const STORAGE_KEY_MAX_BYTES = 1024;

/** A key the port refuses. The message names the rule, never the key. */
export class StorageKeyError extends Error {
  constructor(rule: string) {
    super(`invalid storage key: ${rule}`);
    this.name = 'StorageKeyError';
  }
}

/** Control characters (C0 and DEL) and the backslash, which some tools read as a separator. */
function hasUnsafeCharacter(key: string): boolean {
  for (const character of key) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || character === '\\') {
      return true;
    }
  }
  return false;
}

/** The rule `key` breaks, or `undefined` for a safe key. */
export function storageKeyRule(key: string): string | undefined {
  if (key.length === 0) {
    return 'must not be empty';
  }
  if (Buffer.byteLength(key, 'utf8') > STORAGE_KEY_MAX_BYTES) {
    return `must be at most ${STORAGE_KEY_MAX_BYTES} bytes of UTF-8`;
  }
  if (key.startsWith('/') || key.endsWith('/')) {
    return 'must not start or end with "/"';
  }
  if (hasUnsafeCharacter(key)) {
    return 'must not contain a control character or "\\"';
  }
  if (key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'must not contain an empty, "." or ".." segment';
  }
  return undefined;
}

function assertStorageKey(key: string): void {
  const rule = storageKeyRule(key);
  if (rule !== undefined) {
    throw new StorageKeyError(rule);
  }
}

/** Every segment percent-encoded, so spaces, `+` and non-ASCII letters survive any CDN. */
export function encodeStorageKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * The port as other modules see it: checks every key before the adapter sees it, and builds public
 * URLs without I/O. `publicBaseUrl` has no trailing slash (validated by `loadConfig`).
 */
export class KeyCheckedStorage implements StoragePort, DeclaresAdapterKind {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly publicBaseUrl: string,
  ) {}

  get kind(): StorageAdapter['kind'] {
    return this.adapter.kind;
  }

  put(request: StoragePutRequest): Promise<void> {
    assertStorageKey(request.key);
    return this.adapter.put(request);
  }

  get(bucket: StorageBucket, key: string): Promise<StoredObject> {
    assertStorageKey(key);
    return this.adapter.get(bucket, key);
  }

  delete(bucket: StorageBucket, keys: readonly string[]): Promise<void> {
    keys.forEach(assertStorageKey);
    return keys.length === 0 ? Promise.resolve() : this.adapter.delete(bucket, keys);
  }

  exists(bucket: StorageBucket, key: string): Promise<boolean> {
    assertStorageKey(key);
    return this.adapter.exists(bucket, key);
  }

  publicUrl(key: string): string {
    assertStorageKey(key);
    return `${this.publicBaseUrl}/${encodeStorageKey(key)}`;
  }
}

export type StorageOperation = 'put' | 'get' | 'delete' | 'exists';

const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/**
 * A storage call that failed. It names the operation, the bucket role and the provider's error code
 * only: a provider error can quote the endpoint, the bucket name or the request, so it is neither
 * kept nor chained.
 */
export class StorageError extends Error {
  readonly operation: StorageOperation;
  readonly bucket: StorageBucket;
  readonly reason: 'NOT_FOUND' | 'FAILED';
  readonly code: string | undefined;

  constructor(
    operation: StorageOperation,
    bucket: StorageBucket,
    reason: 'NOT_FOUND' | 'FAILED',
    code: unknown,
  ) {
    const safeCode = typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : undefined;
    super(
      `storage ${operation} failed (bucket ${bucket}, ${reason}, code ${safeCode ?? 'unknown'})`,
    );
    this.name = 'StorageError';
    this.operation = operation;
    this.bucket = bucket;
    this.reason = reason;
    this.code = safeCode;
  }
}
