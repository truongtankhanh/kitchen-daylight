import { ERROR_CODES, ERROR_STATUS } from '@kd/contracts';
import { describe, expect, it } from 'vitest';

import { ApiError } from './api-error.js';

describe('ApiError', () => {
  it('takes its status from ERROR_STATUS', () => {
    expect(new ApiError('BRANCH_CLOSED').status).toBe(409);
    expect(new ApiError('OUT_OF_ZONE').status).toBe(422);
    expect(new ApiError('UPGRADE_REQUIRED').status).toBe(400);
  });

  it('keeps detail, errors and extras', () => {
    const error = new ApiError('VALIDATION_FAILED', {
      detail: 'The request is invalid.',
      errors: [{ field: 'name', code: 'REQUIRED', message: 'is required' }],
      extras: { hint: 'x' },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('The request is invalid.');
    expect(error.detail).toBe('The request is invalid.');
    expect(error.errors).toEqual([{ field: 'name', code: 'REQUIRED', message: 'is required' }]);
    expect(error.extras).toEqual({ hint: 'x' });
  });

  it('gives VALIDATION_FAILED an empty errors list by default, and no list to other codes', () => {
    expect(new ApiError('VALIDATION_FAILED').errors).toEqual([]);
    expect(new ApiError('NOT_FOUND').errors).toBeUndefined();
  });

  it('uses the code as the message when there is no detail', () => {
    const error = new ApiError('NOT_FOUND');
    expect(error.message).toBe('NOT_FOUND');
    expect(error.detail).toBeUndefined();
    expect(error.extras).toEqual({});
  });
});

describe('ERROR_STATUS', () => {
  it('maps each of the 44 catalogue codes to an HTTP error status', () => {
    expect(ERROR_CODES).toHaveLength(44);
    expect(new Set(ERROR_CODES).size).toBe(44);
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400);
      expect(ERROR_STATUS[code], code).toBeLessThan(600);
    }
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });
});
