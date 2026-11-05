import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsNotEmpty,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ApiError } from './api-error.js';
import { createValidationPipe, toFieldErrors } from './validation.pipe.js';

class AddressDto {
  @IsNotEmpty()
  city!: string;
}

class ItemDto {
  @Min(1)
  @Max(99)
  quantity!: number;
}

class OrderDto {
  @IsDefined()
  @MaxLength(5)
  name!: string;

  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items!: ItemDto[];
}

const VALID = {
  name: 'Ana',
  email: 'ana@example.com',
  address: { city: 'Hue' },
  items: [{ quantity: 2 }],
};

async function rejection(body: unknown): Promise<ApiError> {
  const pipe = createValidationPipe();
  const caught = await pipe.transform(body, { type: 'body', metatype: OrderDto }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ApiError);
  return caught as ApiError;
}

describe('createValidationPipe', () => {
  it('accepts a valid body and returns an instance of the DTO', async () => {
    const result: unknown = await createValidationPipe().transform(VALID, {
      type: 'body',
      metatype: OrderDto,
    });
    expect(result).toBeInstanceOf(OrderDto);
    expect((result as OrderDto).items[0]).toBeInstanceOf(ItemDto);
  });

  it('answers 400 VALIDATION_FAILED with errors[]', async () => {
    const error = await rejection({ ...VALID, name: undefined });
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.status).toBe(400);
    expect(error.errors).toEqual([{ field: 'name', code: 'REQUIRED', message: 'is required' }]);
  });

  it('gives a nested object field its dotted path', async () => {
    const error = await rejection({ ...VALID, address: { city: '' } });
    expect(error.errors).toEqual([
      { field: 'address.city', code: 'REQUIRED', message: 'is required' },
    ]);
  });

  it('gives an array item field its index in the path', async () => {
    const error = await rejection({ ...VALID, items: [{ quantity: 2 }, { quantity: 0 }] });
    expect(error.errors).toEqual([
      { field: 'items.1.quantity', code: 'OUT_OF_RANGE', message: 'is out of range' },
    ]);
  });

  it('rejects an unknown property, nested ones included', async () => {
    const error = await rejection({ ...VALID, role: 'ADMIN', address: { city: 'Hue', zip: '1' } });
    expect(error.errors).toEqual(
      expect.arrayContaining([
        { field: 'role', code: 'INVALID', message: 'is not allowed' },
        { field: 'address.zip', code: 'INVALID', message: 'is not allowed' },
      ]),
    );
    expect(error.errors).toHaveLength(2);
  });

  it('maps maxLength to TOO_LONG and isEmail to INVALID_EMAIL', async () => {
    const error = await rejection({ ...VALID, name: 'too-long-name', email: 'not-an-email' });
    expect(error.errors).toEqual(
      expect.arrayContaining([
        { field: 'name', code: 'TOO_LONG', message: 'is too long' },
        { field: 'email', code: 'INVALID_EMAIL', message: 'must be a valid email address' },
      ]),
    );
    expect(error.errors).toHaveLength(2);
  });

  it('collects every error, not only the first', async () => {
    const error = await rejection({ address: { city: '' }, items: [{ quantity: 100 }] });
    const fields = (error.errors ?? []).map((entry) => entry.field);
    expect(fields).toEqual(
      expect.arrayContaining(['name', 'email', 'address.city', 'items.0.quantity']),
    );
  });

  it('never echoes the rejected value', async () => {
    const error = await rejection({
      ...VALID,
      name: 'secret-value-123456',
      email: 'secret-mail@',
      items: [{ quantity: 987654 }],
      password: 'secret-password',
    });
    const text = JSON.stringify(error.errors);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('987654');
  });
});

describe('toFieldErrors', () => {
  it('reports a missing value before the other rules of the same field', () => {
    const errors = [
      { property: 'name', constraints: { maxLength: 'm', isDefined: 'd' }, children: [] },
    ] as ValidationError[];
    expect(toFieldErrors(errors)).toEqual([
      { field: 'name', code: 'REQUIRED', message: 'is required' },
    ]);
  });

  it('uses INVALID for a constraint without a catalogue code (api-divergences D-001)', () => {
    const errors = [
      { property: 'slug', constraints: { matches: 'm' }, children: [] },
    ] as ValidationError[];
    expect(toFieldErrors(errors)).toEqual([
      { field: 'slug', code: 'INVALID', message: 'is invalid' },
    ]);
  });

  it('ignores class-validator messages, which may contain the value', () => {
    const errors = [
      { property: 'email', constraints: { isEmail: 'secret@x is not an email' }, children: [] },
    ] as ValidationError[];
    expect(JSON.stringify(toFieldErrors(errors))).not.toContain('secret');
  });
});
