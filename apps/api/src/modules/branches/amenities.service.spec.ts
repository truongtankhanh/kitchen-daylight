import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { amenityConstraintError, amenityInUseError } from './amenities.service.js';

function violation(fields: { code?: string; constraint?: string }): QueryFailedError {
  const driverError = Object.assign(new Error('violation'), fields);
  return new QueryFailedError('INSERT …', [], driverError);
}

describe('amenityInUseError', () => {
  it('is IN_USE (409) with the usage member', () => {
    const usage = {
      count: 2,
      sample: [{ id: '01900000-0000-7000-8000-0000000000b1', name: 'Chi nhánh mẫu' }],
      filter: { amenityId: '01900000-0000-7000-8000-0000000000aa' },
    };

    const error = amenityInUseError(usage);

    expect(error.code).toBe('IN_USE');
    expect(error.status).toBe(409);
    expect(error.extras).toEqual({ usage });
  });
});

describe('amenityConstraintError', () => {
  it('maps the code unique constraint to ALREADY_EXISTS', () => {
    expect(
      amenityConstraintError(violation({ code: '23505', constraint: 'amenities_code_unique' })),
    ).toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('is null for any other error', () => {
    expect(amenityConstraintError(violation({ code: '23505', constraint: 'x' }))).toBeNull();
    expect(amenityConstraintError(new Error('boom'))).toBeNull();
  });
});
