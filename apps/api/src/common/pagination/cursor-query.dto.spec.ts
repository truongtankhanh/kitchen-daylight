import type { ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../errors/api-error.js';
import { createValidationPipe } from '../errors/validation.pipe.js';
import { CursorQueryDto } from './cursor-query.dto.js';

const QUERY: ArgumentMetadata = { type: 'query', metatype: CursorQueryDto };

async function parse(query: Record<string, string>): Promise<CursorQueryDto> {
  return (await createValidationPipe().transform(query, QUERY)) as CursorQueryDto;
}

describe('CursorQueryDto', () => {
  it('defaults to a limit of 20 and no cursor', async () => {
    const query = await parse({});
    expect(query).toBeInstanceOf(CursorQueryDto);
    expect(query).toEqual({ limit: 20 });
  });

  it('keeps the cursor as an opaque string and converts the limit', async () => {
    expect(await parse({ cursor: 'eyJ2IjoxfQ', limit: '50' })).toEqual({
      cursor: 'eyJ2IjoxfQ',
      limit: 50,
    });
  });

  it.each(['0', '51'])('rejects limit %s with OUT_OF_RANGE', async (limit) => {
    const error: unknown = await parse({ limit }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).errors).toEqual([
      { field: 'limit', code: 'OUT_OF_RANGE', message: 'is out of range' },
    ]);
  });
});
