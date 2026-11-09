import type { ArgumentMetadata, Type } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { AdminBranchCreateDto, AdminBranchUpdateDto } from './dto/admin-branch-input.dto.js';
import {
  AdminBranchDeleteQueryDto,
  AdminBranchesQueryDto,
} from './dto/admin-branches-query.dto.js';

// The DTO validators of `/admin/branches` (A5-T2) through the real global validation pipe, so the
// field codes are the ones a client receives.

const pipe = createValidationPipe();

async function validate<T>(type: Type<T>, value: unknown, kind: 'body' | 'query' = 'body') {
  const metadata: ArgumentMetadata = { type: kind, metatype: type };
  return (await pipe.transform(value, metadata)) as T;
}

/** The `{ field, code }` pairs of a refused value, sorted by field; `[]` when it passes. */
async function fieldErrors(type: Type<unknown>, value: unknown, kind: 'body' | 'query' = 'body') {
  try {
    await validate(type, value, kind);
    return [];
  } catch (error) {
    if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
      return (error.errors ?? [])
        .map(({ field, code }) => ({ field, code }))
        .sort((a, b) => a.field.localeCompare(b.field));
    }
    throw error;
  }
}

function validCreate(): Record<string, unknown> {
  return {
    code: 'BT',
    name: '  Chi nhánh Mẫu  ',
    addressLine: '1 Đường Mẫu',
    provinceCode: '79',
    location: { lat: 10.77, lng: 106.7 },
    phone: '+842800000001',
    status: 'ACTIVE',
    acceptsPickup: true,
    acceptsDelivery: false,
    acceptsReservations: false,
    defaultPrepMinutes: 15,
    orderCutoffMinutes: 30,
    reservationSlotStepMinutes: 15,
    reservationMaxParty: 8,
    reservationLeadMinutes: 60,
    reservationMaxDaysAhead: 30,
  };
}

describe('AdminBranchCreateDto', () => {
  it('accepts a complete body and trims the name', async () => {
    const dto = await validate(AdminBranchCreateDto, validCreate());

    expect(dto.name).toBe('Chi nhánh Mẫu');
    expect(dto.reservationDurationMinutes).toBeUndefined();
  });

  it('requires every field without a database default', async () => {
    const errors = await fieldErrors(AdminBranchCreateDto, {});
    const required = errors.filter(({ code }) => code === 'REQUIRED').map(({ field }) => field);

    expect(required.sort()).toEqual(
      [
        'acceptsDelivery',
        'acceptsPickup',
        'acceptsReservations',
        'addressLine',
        'code',
        'defaultPrepMinutes',
        'location',
        'name',
        'orderCutoffMinutes',
        'phone',
        'provinceCode',
        'reservationLeadMinutes',
        'reservationMaxDaysAhead',
        'reservationMaxParty',
        'reservationSlotStepMinutes',
        'status',
      ].sort(),
    );
  });

  it.each(['B', 'BTXYZ', 'bt', 'B1', 'ĐT'])('refuses the code %s', async (code) => {
    expect(await fieldErrors(AdminBranchCreateDto, { ...validCreate(), code })).toEqual([
      { field: 'code', code: 'INVALID' },
    ]);
  });

  it('refuses a malformed slug and accepts a well-formed one', async () => {
    expect(
      await fieldErrors(AdminBranchCreateDto, { ...validCreate(), slug: 'Bến-Thành' }),
    ).toEqual([{ field: 'slug', code: 'INVALID' }]);
    expect(await fieldErrors(AdminBranchCreateDto, { ...validCreate(), slug: 'a--b' })).toEqual([
      { field: 'slug', code: 'INVALID' },
    ]);
    expect(
      await fieldErrors(AdminBranchCreateDto, { ...validCreate(), slug: 'ben-thanh-2' }),
    ).toEqual([]);
  });

  it('range-checks the pin', async () => {
    const errors = await fieldErrors(AdminBranchCreateDto, {
      ...validCreate(),
      location: { lat: 91, lng: -181 },
    });

    expect(errors).toEqual([
      { field: 'location.lat', code: 'OUT_OF_RANGE' },
      { field: 'location.lng', code: 'OUT_OF_RANGE' },
    ]);
  });

  it('refuses a pin that is not two numbers', async () => {
    const errors = await fieldErrors(AdminBranchCreateDto, {
      ...validCreate(),
      location: { lat: 'x' },
    });

    expect(errors.map(({ field }) => field)).toEqual(['location.lat', 'location.lng']);
    expect(errors[1]).toEqual({ field: 'location.lng', code: 'REQUIRED' });
  });

  it('maps the reservation limits to OUT_OF_RANGE', async () => {
    const errors = await fieldErrors(AdminBranchCreateDto, {
      ...validCreate(),
      reservationDurationMinutes: 255,
      reservationSlotStepMinutes: 45,
      reservationMaxParty: 0,
      reservationLeadMinutes: 1441,
      reservationMaxDaysAhead: 91,
    });

    expect(errors).toEqual([
      { field: 'reservationDurationMinutes', code: 'OUT_OF_RANGE' },
      { field: 'reservationLeadMinutes', code: 'OUT_OF_RANGE' },
      { field: 'reservationMaxDaysAhead', code: 'OUT_OF_RANGE' },
      { field: 'reservationMaxParty', code: 'OUT_OF_RANGE' },
      { field: 'reservationSlotStepMinutes', code: 'OUT_OF_RANGE' },
    ]);
  });

  it('requires vi in the description and limits its length', async () => {
    expect(
      await fieldErrors(AdminBranchCreateDto, { ...validCreate(), description: { en: 'About' } }),
    ).toEqual([{ field: 'description.vi', code: 'REQUIRED' }]);
    expect(
      await fieldErrors(AdminBranchCreateDto, {
        ...validCreate(),
        description: { vi: 'x'.repeat(2001) },
      }),
    ).toEqual([{ field: 'description.vi', code: 'TOO_LONG' }]);
    expect(
      await fieldErrors(AdminBranchCreateDto, {
        ...validCreate(),
        description: { vi: 'Mô tả', fr: 'x' },
      }),
    ).toEqual([{ field: 'description.fr', code: 'INVALID' }]);
  });

  it('refuses the fields that only PATCH takes', async () => {
    const errors = await fieldErrors(AdminBranchCreateDto, {
      ...validCreate(),
      websiteUrl: 'https://kitchendaylight.example',
      rowVersion: 1,
    });

    expect(errors).toEqual([
      { field: 'rowVersion', code: 'INVALID' },
      { field: 'websiteUrl', code: 'INVALID' },
    ]);
  });
});

describe('AdminBranchUpdateDto', () => {
  it('needs rowVersion and nothing else', async () => {
    expect(await fieldErrors(AdminBranchUpdateDto, {})).toEqual([
      { field: 'rowVersion', code: 'REQUIRED' },
    ]);
    expect(await fieldErrors(AdminBranchUpdateDto, { rowVersion: 3 })).toEqual([]);
  });

  it('refuses slug: it is immutable', async () => {
    expect(await fieldErrors(AdminBranchUpdateDto, { rowVersion: 1, slug: 'moi' })).toEqual([
      { field: 'slug', code: 'INVALID' },
    ]);
  });

  it('refuses null on a column that cannot be empty', async () => {
    const errors = await fieldErrors(AdminBranchUpdateDto, {
      rowVersion: 1,
      name: null,
      phone: null,
      acceptsDelivery: null,
      location: null,
      amenityIds: null,
    });

    expect(errors.map(({ field }) => field)).toEqual([
      'acceptsDelivery',
      'amenityIds',
      'location',
      'name',
      'phone',
    ]);
  });

  it('accepts null on the nullable fields', async () => {
    expect(
      await fieldErrors(AdminBranchUpdateDto, {
        rowVersion: 1,
        description: null,
        wardCode: null,
        websiteUrl: null,
        pauseMessage: null,
      }),
    ).toEqual([]);
  });

  it('limits websiteUrl to 255 and pauseMessage to 200 characters', async () => {
    const errors = await fieldErrors(AdminBranchUpdateDto, {
      rowVersion: 1,
      websiteUrl: `https://${'a'.repeat(248)}`,
      pauseMessage: 'x'.repeat(201),
    });

    expect(errors).toEqual([
      { field: 'pauseMessage', code: 'TOO_LONG' },
      { field: 'websiteUrl', code: 'TOO_LONG' },
    ]);
  });

  it('takes amenityIds as distinct UUIDs', async () => {
    const id = '01930000-0000-7000-8000-0000000005c1';

    expect(await fieldErrors(AdminBranchUpdateDto, { rowVersion: 1, amenityIds: [id] })).toEqual(
      [],
    );
    expect(await fieldErrors(AdminBranchUpdateDto, { rowVersion: 1, amenityIds: [] })).toEqual([]);
    expect(
      await fieldErrors(AdminBranchUpdateDto, { rowVersion: 1, amenityIds: [id, id] }),
    ).toEqual([{ field: 'amenityIds', code: 'INVALID' }]);
    expect(
      await fieldErrors(AdminBranchUpdateDto, { rowVersion: 1, amenityIds: ['not-a-uuid'] }),
    ).toEqual([{ field: 'amenityIds', code: 'INVALID' }]);
  });

  it('refuses a rowVersion below 1', async () => {
    expect(await fieldErrors(AdminBranchUpdateDto, { rowVersion: 0 })).toEqual([
      { field: 'rowVersion', code: 'OUT_OF_RANGE' },
    ]);
  });
});

describe('AdminBranchesQueryDto', () => {
  it('defaults the page and accepts q and status', async () => {
    const dto = await validate(AdminBranchesQueryDto, { q: 'ben', status: 'ACTIVE' }, 'query');

    expect({ page: dto.page, pageSize: dto.pageSize, q: dto.q, status: dto.status }).toEqual({
      page: 1,
      pageSize: 20,
      q: 'ben',
      status: 'ACTIVE',
    });
  });

  it('refuses an unknown status, a page size above 50 and an unknown parameter', async () => {
    const errors = await fieldErrors(
      AdminBranchesQueryDto,
      { status: 'OPEN', pageSize: '51', branchIds: 'x' },
      'query',
    );

    expect(errors).toEqual([
      { field: 'branchIds', code: 'INVALID' },
      { field: 'pageSize', code: 'OUT_OF_RANGE' },
      { field: 'status', code: 'INVALID' },
    ]);
  });
});

describe('AdminBranchDeleteQueryDto', () => {
  it('requires rowVersion as an integer from the query string', async () => {
    expect(
      (await validate(AdminBranchDeleteQueryDto, { rowVersion: '4' }, 'query')).rowVersion,
    ).toBe(4);
    expect(await fieldErrors(AdminBranchDeleteQueryDto, {}, 'query')).toEqual([
      { field: 'rowVersion', code: 'REQUIRED' },
    ]);
    expect(await fieldErrors(AdminBranchDeleteQueryDto, { rowVersion: '1.5' }, 'query')).toEqual([
      { field: 'rowVersion', code: 'INVALID' },
    ]);
  });
});
