import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import {
  branchAuditLabel,
  branchFieldErrors,
  buildBranchUpdate,
  constraintError,
  descriptionValue,
  isHttpsUrl,
  normalizeBranchPhone,
  ratingAverage,
  slugForNewBranch,
} from './branches.service.js';

const BRANCH_ID = '01930000-0000-7000-8000-0000000005b1';
const ACTOR_ID = '01930000-0000-7000-8000-0000000005a1';

function violation(constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error('violation'), { constraint });
  return new QueryFailedError('INSERT …', [], driverError);
}

describe('normalizeBranchPhone', () => {
  it('accepts E.164, landlines included, and removes spaces, dots and hyphens', () => {
    expect(normalizeBranchPhone('+842838221234')).toBe('+842838221234');
    expect(normalizeBranchPhone('+84 28 3822 1234')).toBe('+842838221234');
    expect(normalizeBranchPhone('+84-90.123.4567')).toBe('+84901234567');
  });

  it('refuses the national form and anything that is not E.164', () => {
    expect(normalizeBranchPhone('02838221234')).toBeNull();
    expect(normalizeBranchPhone('0901234567')).toBeNull();
    expect(normalizeBranchPhone('+0123')).toBeNull();
    expect(normalizeBranchPhone('+1234567890123456')).toBeNull();
    expect(normalizeBranchPhone('+84 (28) 3822')).toBeNull();
    expect(normalizeBranchPhone('')).toBeNull();
  });
});

describe('isHttpsUrl', () => {
  it('accepts an https link with a host', () => {
    expect(isHttpsUrl('https://kitchendaylight.example/chi-nhanh')).toBe(true);
  });

  it('refuses http, a missing host and whitespace', () => {
    expect(isHttpsUrl('http://kitchendaylight.example')).toBe(false);
    expect(isHttpsUrl('https://')).toBe(false);
    expect(isHttpsUrl('https://kitchen daylight.example')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('branchFieldErrors', () => {
  it('returns nothing for valid or absent fields', () => {
    expect(branchFieldErrors({})).toEqual([]);
    expect(
      branchFieldErrors({
        phone: '+842838221234',
        websiteUrl: 'https://kitchendaylight.example',
        reservationDurationMinutes: 105,
        reservationSlotStepMinutes: 30,
      }),
    ).toEqual([]);
    expect(branchFieldErrors({ websiteUrl: null })).toEqual([]);
    expect(branchFieldErrors({ websiteUrl: '' })).toEqual([]);
  });

  it('maps each broken rule to its field and code', () => {
    const errors = branchFieldErrors({
      phone: '02838221234',
      websiteUrl: 'http://kitchendaylight.example',
      reservationDurationMinutes: 100,
      reservationSlotStepMinutes: 20,
    });

    expect(errors.map(({ field, code }) => ({ field, code }))).toEqual([
      { field: 'phone', code: 'INVALID_PHONE' },
      { field: 'websiteUrl', code: 'INVALID' },
      { field: 'reservationDurationMinutes', code: 'OUT_OF_RANGE' },
      { field: 'reservationSlotStepMinutes', code: 'OUT_OF_RANGE' },
    ]);
  });

  it('never repeats the rejected value in a message', () => {
    const errors = branchFieldErrors({ phone: '0283 822 1234' });

    expect(JSON.stringify(errors)).not.toContain('0283');
  });
});

describe('ratingAverage', () => {
  it('is null without reviews', () => {
    expect(ratingAverage(0, 0)).toBeNull();
  });

  it('is the plain average rounded half up to one decimal', () => {
    expect(ratingAverage(9, 2)).toBe(4.5);
    expect(ratingAverage(13, 3)).toBe(4.3);
    expect(ratingAverage(17, 4)).toBe(4.3);
    expect(ratingAverage(5, 1)).toBe(5);
  });
});

describe('slugForNewBranch', () => {
  it('keeps a slug that was sent', () => {
    expect(slugForNewBranch('Chi nhánh Bến Thành', 'ben-thanh')).toBe('ben-thanh');
  });

  it('derives the slug from the name', () => {
    expect(slugForNewBranch('Chi nhánh Đa Kao', undefined)).toBe('chi-nhanh-da-kao');
  });

  it('cuts a long name to 100 characters without a trailing hyphen', () => {
    const slug = slugForNewBranch(`${'a'.repeat(99)} bcd`, undefined);

    expect(slug).toBe('a'.repeat(99));
  });

  it('is null when the name has no letter or digit', () => {
    expect(slugForNewBranch('!!!', undefined)).toBeNull();
  });
});

describe('descriptionValue', () => {
  it('keeps vi, keeps a non-empty en and drops an empty one', () => {
    expect(descriptionValue(null)).toBeNull();
    expect(descriptionValue({ vi: 'Mô tả' })).toEqual({ vi: 'Mô tả' });
    expect(descriptionValue({ vi: 'Mô tả', en: '' })).toEqual({ vi: 'Mô tả' });
    expect(descriptionValue({ vi: 'Mô tả', en: 'About' })).toEqual({ vi: 'Mô tả', en: 'About' });
  });
});

describe('branchAuditLabel', () => {
  it('is the name, or the code when the name cannot be an audit label', () => {
    expect(branchAuditLabel('Chi nhánh Mẫu', 'BT')).toBe('Chi nhánh Mẫu');
    expect(branchAuditLabel('mau@kd.example', 'BT')).toBe('BT');
  });
});

describe('constraintError', () => {
  it('maps the unique keys to ALREADY_EXISTS', () => {
    expect(constraintError(violation('branches_code_unique'))?.code).toBe('ALREADY_EXISTS');
    expect(constraintError(violation('branches_slug_unique'))?.code).toBe('ALREADY_EXISTS');
  });

  it('maps the province, ward and amenity keys to a field error', () => {
    const fields = [
      'branches_province_fkey',
      'branches_ward_fkey',
      'branch_amenities_amenity_fkey',
    ].map((name) => {
      const error = constraintError(violation(name));
      return error?.code === 'VALIDATION_FAILED' ? error.errors?.[0] : undefined;
    });

    expect(fields).toEqual([
      { field: 'provinceCode', code: 'NOT_FOUND', message: 'does not exist' },
      { field: 'wardCode', code: 'NOT_FOUND', message: 'is not a ward of the province' },
      { field: 'amenityIds', code: 'NOT_FOUND', message: 'names an amenity that does not exist' },
    ]);
  });

  it('is null for any other error', () => {
    expect(constraintError(violation('branches_code_format'))).toBeNull();
    expect(constraintError(new Error('boom'))).toBeNull();
    expect(constraintError(new ApiError('NOT_FOUND'))).toBeNull();
  });
});

describe('buildBranchUpdate', () => {
  it('always sets updated_by, then targets the branch', () => {
    const { sql, parameters } = buildBranchUpdate(BRANCH_ID, ACTOR_ID, {});

    expect(sql).toBe('UPDATE public.branches SET updated_by = $1::uuid WHERE id = $2::uuid');
    expect(parameters).toEqual([ACTOR_ID, BRANCH_ID]);
  });

  it('writes only the fields sent, the phone in E.164 and blank text as null', () => {
    const { sql, parameters } = buildBranchUpdate(BRANCH_ID, ACTOR_ID, {
      name: 'Chi nhánh Mới',
      phone: '+84 28 3822 1234',
      status: 'TEMPORARILY_CLOSED',
      wardCode: null,
      pauseMessage: '',
    });

    expect(sql).toBe(
      'UPDATE public.branches SET name = $1, ward_code = $2, phone = $3, ' +
        'status = $4::public.branch_status, pause_message = $5, updated_by = $6::uuid ' +
        'WHERE id = $7::uuid',
    );
    expect(parameters).toEqual([
      'Chi nhánh Mới',
      null,
      '+842838221234',
      'TEMPORARILY_CLOSED',
      null,
      ACTOR_ID,
      BRANCH_ID,
    ]);
  });

  it('writes the description as jsonb and the pin from longitude and latitude', () => {
    const { sql, parameters } = buildBranchUpdate(BRANCH_ID, ACTOR_ID, {
      description: { vi: 'Mô tả' },
      location: { lat: 10.77, lng: 106.7 },
    });

    expect(sql).toContain('description = $1::jsonb');
    expect(sql).toContain(
      'location = ST_SetSRID(ST_MakePoint($2::double precision, $3::double precision), 4326)::geography',
    );
    expect(parameters.slice(0, 3)).toEqual(['{"vi":"Mô tả"}', 106.7, 10.77]);
  });

  it('clears the description with null', () => {
    const { sql, parameters } = buildBranchUpdate(BRANCH_ID, ACTOR_ID, { description: null });

    expect(sql).toContain('description = $1::jsonb');
    expect(parameters[0]).toBeNull();
  });
});
