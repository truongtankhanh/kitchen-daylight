import { describe, expect, it, vi } from 'vitest';

import { REFRESH_GRACE_WINDOW_MS, RefreshGrace } from './refresh-grace.js';

interface Result {
  readonly familyId: string;
  readonly value: string;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RefreshGrace', () => {
  it('is a 10-second window', () => {
    expect(REFRESH_GRACE_WINDOW_MS).toBe(10_000);
  });

  it('hands a concurrent caller the in-flight rotation', async () => {
    const grace = new RefreshGrace<Result>();
    const now = 1_000;
    const pending = deferred<Result>();
    const work = vi.fn(() => pending.promise);

    const first = grace.start('k', work, () => now);
    const second = grace.get('k', now);

    expect(second).toBe(first);
    pending.resolve({ familyId: 'f', value: 'successor' });
    await expect(second).resolves.toEqual({ familyId: 'f', value: 'successor' });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('keeps a success for the window after it settled, and no longer', async () => {
    const grace = new RefreshGrace<Result>();
    let now = 5_000;
    await grace.start(
      'k',
      () => Promise.resolve({ familyId: 'f', value: 'v' }),
      () => now,
    );

    now += REFRESH_GRACE_WINDOW_MS;
    await expect(grace.get('k', now)).resolves.toEqual({ familyId: 'f', value: 'v' });
    now += 1;
    expect(grace.get('k', now)).toBeUndefined();
    expect(grace.size).toBe(0);
  });

  it('drops a failed rotation at once', async () => {
    const grace = new RefreshGrace<Result>();
    const failure = new Error('fixture failure');

    await expect(
      grace.start(
        'k',
        () => Promise.reject(failure),
        () => 0,
      ),
    ).rejects.toBe(failure);
    expect(grace.get('k', 0)).toBeUndefined();
  });

  it('forgets every entry of a revoked family', async () => {
    const grace = new RefreshGrace<Result>();
    await grace.start(
      'a',
      () => Promise.resolve({ familyId: 'f1', value: 'a' }),
      () => 0,
    );
    await grace.start(
      'b',
      () => Promise.resolve({ familyId: 'f1', value: 'b' }),
      () => 0,
    );
    await grace.start(
      'c',
      () => Promise.resolve({ familyId: 'f2', value: 'c' }),
      () => 0,
    );

    grace.forgetFamily('f1');

    expect(grace.get('a', 0)).toBeUndefined();
    expect(grace.get('b', 0)).toBeUndefined();
    expect(grace.get('c', 0)).toBeDefined();
  });

  it('sweeps entries older than the window when a new rotation starts', async () => {
    const grace = new RefreshGrace<Result>();
    let now = 0;
    await grace.start(
      'old',
      () => Promise.resolve({ familyId: 'f', value: 'o' }),
      () => now,
    );

    now = REFRESH_GRACE_WINDOW_MS + 1;
    await grace.start(
      'new',
      () => Promise.resolve({ familyId: 'g', value: 'n' }),
      () => now,
    );

    expect(grace.size).toBe(1);
  });
});
