import type { StaleVersionPayload } from '@kd/contracts';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors/api-error.js';
import { assertRowVersion } from './row-version.js';

const UPDATED_AT = new Date('2026-10-27T03:15:00.000Z');
const EDITOR = { id: '0199a3c0-0000-7000-8000-000000000001', name: 'Lan' };

function thrown(run: () => void): ApiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected an ApiError');
}

describe('assertRowVersion', () => {
  it('passes when the versions match', () => {
    expect(() =>
      assertRowVersion(3, { rowVersion: 3, updatedBy: EDITOR, updatedAt: UPDATED_AT }),
    ).not.toThrow();
  });

  it('raises 409 STALE_VERSION with the current state when they differ', () => {
    const error = thrown(() =>
      assertRowVersion(2, { rowVersion: 3, updatedBy: EDITOR, updatedAt: UPDATED_AT }),
    );
    const expected: StaleVersionPayload = {
      current: { rowVersion: 3, updatedBy: EDITOR, updatedAt: '2026-10-27T03:15:00.000Z' },
    };

    expect(error.code).toBe('STALE_VERSION');
    expect(error.status).toBe(409);
    expect(error.errors).toBeUndefined();
    expect(error.extras).toEqual(expected);
  });

  it('gives a null updatedBy for a system change', () => {
    const error = thrown(() =>
      assertRowVersion(1, { rowVersion: 2, updatedBy: null, updatedAt: UPDATED_AT }),
    );
    expect(error.extras).toEqual({
      current: { rowVersion: 2, updatedBy: null, updatedAt: '2026-10-27T03:15:00.000Z' },
    });
  });

  it('copies only the id and the name of the editor', () => {
    const editor = { ...EDITOR, email: 'lan@example.com' };
    const error = thrown(() =>
      assertRowVersion(1, { rowVersion: 2, updatedBy: editor, updatedAt: UPDATED_AT }),
    );
    expect(error.extras).toEqual({
      current: { rowVersion: 2, updatedBy: EDITOR, updatedAt: '2026-10-27T03:15:00.000Z' },
    });
  });
});
