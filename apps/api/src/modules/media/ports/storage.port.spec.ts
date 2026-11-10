import { describe, expect, it } from 'vitest';

import {
  KeyCheckedStorage,
  STORAGE_KEY_MAX_BYTES,
  StorageError,
  StorageKeyError,
  storageKeyRule,
} from './storage.port.js';
import type { StorageAdapter, StorageBucket, StoragePutRequest } from './storage.port.js';

/** Records every call that reaches the adapter. */
function recordingAdapter(): StorageAdapter & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    kind: 'emulator',
    calls,
    put: (request: StoragePutRequest) => {
      calls.push(`put ${request.bucket} ${request.key}`);
      return Promise.resolve();
    },
    get: () => Promise.reject(new Error('not used')),
    delete: (bucket: StorageBucket, keys: readonly string[]) => {
      calls.push(`delete ${bucket} ${keys.join(',')}`);
      return Promise.resolve();
    },
    exists: (bucket: StorageBucket, key: string) => {
      calls.push(`exists ${bucket} ${key}`);
      return Promise.resolve(true);
    },
  };
}

const BASE_URL = 'https://media.kitchendaylight.example';

describe('storageKeyRule', () => {
  it.each([
    'media/2026/11/0190a5c2-7d1e-7b3a-9c4f-2e8d1a6b5f30/thumb.webp',
    'exports/run 1/Thực đơn + giá.xlsx',
    'a',
    'x'.repeat(STORAGE_KEY_MAX_BYTES),
  ])('accepts %s', (key) => {
    expect(storageKeyRule(key)).toBeUndefined();
  });

  it.each([
    ['', 'must not be empty'],
    ['/media/a.webp', 'must not start or end with "/"'],
    ['media/', 'must not start or end with "/"'],
    ['media//a.webp', 'must not contain an empty, "." or ".." segment'],
    ['media/../private/a', 'must not contain an empty, "." or ".." segment'],
    ['..', 'must not contain an empty, "." or ".." segment'],
    ['media/./a', 'must not contain an empty, "." or ".." segment'],
    ['media\\a.webp', 'must not contain a control character or "\\"'],
    ['media/a\u0000.webp', 'must not contain a control character or "\\"'],
    ['media/a\n.webp', 'must not contain a control character or "\\"'],
    ['media/a\u007f.webp', 'must not contain a control character or "\\"'],
  ])('refuses %j', (key, rule) => {
    expect(storageKeyRule(key)).toBe(rule);
  });

  it('counts the limit in UTF-8 bytes, not characters', () => {
    // "ự" is three bytes in UTF-8.
    const key = 'ự'.repeat(Math.floor(STORAGE_KEY_MAX_BYTES / 3) + 1);

    expect(key.length).toBeLessThan(STORAGE_KEY_MAX_BYTES);
    expect(storageKeyRule(key)).toBe(`must be at most ${STORAGE_KEY_MAX_BYTES} bytes of UTF-8`);
  });
});

describe('KeyCheckedStorage', () => {
  it('never hands an unsafe key to the adapter, and names the rule but not the key', async () => {
    const adapter = recordingAdapter();
    const storage = new KeyCheckedStorage(adapter, BASE_URL);
    const key = 'media/../leak-check-key';

    // The checks throw synchronously; `then` turns that into a rejection.
    const attempts: readonly (() => Promise<unknown>)[] = [
      () => storage.put({ bucket: 'MEDIA', key, body: new Uint8Array(1), contentType: 'x/y' }),
      () => storage.get('MEDIA', key),
      () => storage.exists('PRIVATE', key),
      () => storage.delete('MEDIA', ['media/ok.webp', key]),
      () => Promise.resolve(storage.publicUrl(key)),
    ];
    for (const attempt of attempts) {
      const error = await Promise.resolve()
        .then(attempt)
        .then(
          () => undefined,
          (thrown: unknown) => thrown,
        );
      expect(error).toBeInstanceOf(StorageKeyError);
      expect((error as Error).message).not.toContain('leak-check');
    }
    expect(adapter.calls).toEqual([]);
  });

  it('passes safe keys through and reports the adapter kind', async () => {
    const adapter = recordingAdapter();
    const storage = new KeyCheckedStorage(adapter, BASE_URL);

    await storage.put({
      bucket: 'MEDIA',
      key: 'media/a.webp',
      body: new Uint8Array(1),
      contentType: 'image/webp',
    });
    await storage.exists('PRIVATE', 'exports/a.xlsx');
    await storage.delete('MEDIA', ['media/a.webp', 'media/b.webp']);

    expect(storage.kind).toBe('emulator');
    expect(adapter.calls).toEqual([
      'put MEDIA media/a.webp',
      'exists PRIVATE exports/a.xlsx',
      'delete MEDIA media/a.webp,media/b.webp',
    ]);
  });

  it('does not call the adapter for an empty delete', async () => {
    const adapter = recordingAdapter();

    await new KeyCheckedStorage(adapter, BASE_URL).delete('MEDIA', []);

    expect(adapter.calls).toEqual([]);
  });

  it('builds public URLs under the base, each segment percent-encoded', () => {
    const storage = new KeyCheckedStorage(recordingAdapter(), BASE_URL);

    expect(storage.publicUrl('media/2026/11/abc/thumb.webp')).toBe(
      `${BASE_URL}/media/2026/11/abc/thumb.webp`,
    );
    expect(storage.publicUrl('media/Thực đơn + giá.webp')).toBe(
      `${BASE_URL}/media/Th%E1%BB%B1c%20%C4%91%C6%A1n%20%2B%20gi%C3%A1.webp`,
    );
  });
});

describe('StorageError', () => {
  it('keeps a safe provider code and drops anything else', () => {
    expect(new StorageError('get', 'MEDIA', 'NOT_FOUND', 'NoSuchKey').message).toBe(
      'storage get failed (bucket MEDIA, NOT_FOUND, code NoSuchKey)',
    );
    const unsafe = new StorageError('put', 'PRIVATE', 'FAILED', 'http://leak-check.invalid/key');

    expect(unsafe.code).toBeUndefined();
    expect(unsafe.message).toBe('storage put failed (bucket PRIVATE, FAILED, code unknown)');
  });
});
