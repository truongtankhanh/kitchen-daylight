import { createHash } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { Province } from './entities/province.entity.js';
import type { ProvinceType } from './entities/province.entity.js';
import { Ward } from './entities/ward.entity.js';
import type { WardType } from './entities/ward.entity.js';
import {
  GEO_CACHE_CONTROL,
  GeoService,
  rankWardMatches,
  sortAdminUnits,
  strongEtag,
  toAdminUnitView,
} from './geo.service.js';
import type { AdminUnitView, WardMatch } from './geo.service.js';

// Fictional rows in the shape of the official list; the codes are made up.

function province(code: string, vi: string, type: ProvinceType = 'PROVINCE'): Province {
  return Object.assign(new Province(), {
    code,
    names: { vi, vi_full: `${type === 'CITY' ? 'Thành phố' : 'Tỉnh'} ${vi}` },
    type,
  });
}

function ward(code: string, provinceCode: string, vi: string, type: WardType = 'WARD'): Ward {
  const prefix = type === 'WARD' ? 'Phường' : type === 'COMMUNE' ? 'Xã' : 'Đặc khu';
  return Object.assign(new Ward(), {
    code,
    provinceCode,
    names: { vi, vi_full: `${prefix} ${vi}` },
    type,
  });
}

interface FakeTables {
  readonly provinces: readonly Province[];
  readonly wards: readonly Ward[];
}

/** A `DataSource` whose two repositories filter in memory and record their calls. */
function fakeDataSource(tables: FakeTables) {
  const provinceRepository = {
    find: vi.fn(async () => [...tables.provinces]),
    exists: vi.fn(async ({ where }: { where: { code: string } }) =>
      tables.provinces.some((row) => row.code === where.code),
    ),
  };
  const wardRepository = {
    find: vi.fn(async ({ where }: { where: { provinceCode: string } }) =>
      tables.wards.filter((row) => row.provinceCode === where.provinceCode),
    ),
  };
  const dataSource = {
    getRepository: (target: unknown) => {
      if (target === Province) return provinceRepository;
      if (target === Ward) return wardRepository;
      throw new Error('unexpected repository');
    },
  } as unknown as DataSource;
  return { dataSource, provinceRepository, wardRepository };
}

const collator = new Intl.Collator('vi');

function view(code: string, name: string): AdminUnitView<'WARD'> {
  return { code, name, fullName: `Phường ${name}`, type: 'WARD' };
}

describe('toAdminUnitView', () => {
  it('maps names.vi to name and names.vi_full to fullName', () => {
    expect(toAdminUnitView(province('90', 'Mẫu Lâm', 'CITY'))).toEqual({
      code: '90',
      name: 'Mẫu Lâm',
      fullName: 'Thành phố Mẫu Lâm',
      type: 'CITY',
    });
  });

  it('falls back to names.vi when a row has no vi_full (the column only requires vi)', () => {
    expect(toAdminUnitView({ code: '90001', names: { vi: 'Mẫu Lâm' }, type: 'COMMUNE' })).toEqual({
      code: '90001',
      name: 'Mẫu Lâm',
      fullName: 'Mẫu Lâm',
      type: 'COMMUNE',
    });
  });
});

describe('sortAdminUnits', () => {
  it('sorts with the Vietnamese collator: Đ after D, tone marks next to their base letter', () => {
    const names = ['Ô Môn', 'Đức Hòa', 'Bà Mẫu', 'Dĩ An', 'An Phú', 'Ba Mẫu', 'Ánh Sáng', 'Cờ Đỏ'];
    const units = names.map((name, index) => view(String(90001 + index), name));

    expect(sortAdminUnits(units, collator).map((unit) => unit.name)).toEqual([
      'An Phú',
      'Ánh Sáng',
      'Ba Mẫu',
      'Bà Mẫu',
      'Cờ Đỏ',
      'Dĩ An',
      'Đức Hòa',
      'Ô Môn',
    ]);
  });

  it('orders two units with the same name by code', () => {
    const sorted = sortAdminUnits([view('90009', 'Mẫu'), view('90001', 'Mẫu')], collator);

    expect(sorted.map((unit) => unit.code)).toEqual(['90001', '90009']);
  });

  it('returns a new array and leaves the input untouched', () => {
    const units = [view('90002', 'Mẫu B'), view('90001', 'Mẫu A')];

    const sorted = sortAdminUnits(units, collator);

    expect(sorted).not.toBe(units);
    expect(units.map((unit) => unit.code)).toEqual(['90002', '90001']);
  });
});

describe('strongEtag', () => {
  it('is the quoted base64url SHA-256 of the JSON body', () => {
    const body = [{ code: '90', name: 'Mẫu Lâm' }];
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('base64url');

    expect(strongEtag(body)).toBe(`"${digest}"`);
    expect(strongEtag(body)).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
  });

  it('changes when a name changes and stays equal for an equal body', () => {
    const before = [{ code: '90', name: 'Mẫu Lâm' }];

    expect(strongEtag(before)).toBe(strongEtag([{ code: '90', name: 'Mẫu Lâm' }]));
    expect(strongEtag(before)).not.toBe(strongEtag([{ code: '90', name: 'Mẫu Lam' }]));
  });
});

describe('GEO_CACHE_CONTROL', () => {
  it('lets clients and shared caches keep the lists for a day', () => {
    expect(GEO_CACHE_CONTROL).toBe('public, max-age=86400');
  });
});

describe('GeoService', () => {
  const tables: FakeTables = {
    provinces: [
      province('92', 'Đồng Mẫu'),
      province('90', 'Mẫu Lâm', 'CITY'),
      province('91', 'An Mẫu'),
    ],
    wards: [
      ward('90003', '90', 'Đông Mẫu', 'COMMUNE'),
      ward('90001', '90', 'Bến Mẫu'),
      ward('90002', '90', 'An Mẫu', 'SPECIAL_ZONE'),
      ward('91001', '91', 'Khác'),
    ],
  };

  it('lists every province, mapped and sorted by name', async () => {
    const { dataSource } = fakeDataSource(tables);

    await expect(new GeoService(dataSource).listProvinces()).resolves.toEqual([
      { code: '91', name: 'An Mẫu', fullName: 'Tỉnh An Mẫu', type: 'PROVINCE' },
      { code: '92', name: 'Đồng Mẫu', fullName: 'Tỉnh Đồng Mẫu', type: 'PROVINCE' },
      { code: '90', name: 'Mẫu Lâm', fullName: 'Thành phố Mẫu Lâm', type: 'CITY' },
    ]);
  });

  it('lists the wards of one province only, sorted by name, with one query', async () => {
    const { dataSource, provinceRepository, wardRepository } = fakeDataSource(tables);

    await expect(new GeoService(dataSource).listWards('90')).resolves.toEqual([
      { code: '90002', name: 'An Mẫu', fullName: 'Đặc khu An Mẫu', type: 'SPECIAL_ZONE' },
      { code: '90001', name: 'Bến Mẫu', fullName: 'Phường Bến Mẫu', type: 'WARD' },
      { code: '90003', name: 'Đông Mẫu', fullName: 'Xã Đông Mẫu', type: 'COMMUNE' },
    ]);
    expect(wardRepository.find).toHaveBeenCalledWith({ where: { provinceCode: '90' } });
    expect(provinceRepository.exists).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for an unknown province, without the code in the detail', async () => {
    const { dataSource } = fakeDataSource(tables);

    const error: unknown = await new GeoService(dataSource)
      .listWards('99')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect((error as ApiError).detail).not.toContain('99');
  });

  it('answers an empty list for a known province that has no ward yet', async () => {
    const { dataSource, provinceRepository } = fakeDataSource({
      provinces: tables.provinces,
      wards: [],
    });

    await expect(new GeoService(dataSource).listWards('92')).resolves.toEqual([]);
    expect(provinceRepository.exists).toHaveBeenCalledWith({ where: { code: '92' } });
  });
});

function match(code: string, vi: string, isPrefix: boolean, type: WardType = 'WARD'): WardMatch {
  return {
    code,
    province_code: '90',
    names: { vi, vi_full: `Phường ${vi}` },
    type,
    is_prefix: isPrefix,
  };
}

describe('rankWardMatches', () => {
  it('puts prefix matches first, each group by Vietnamese name then code', () => {
    const rows = [
      match('90005', 'Đình Mẫu', false),
      match('90004', 'Ba Mẫu Đình', true),
      match('90003', 'An Ba Mẫu', false),
      match('90002', 'Bà Mẫu', true),
      match('90001', 'Ba Mẫu', true),
      match('90009', 'Ba Mẫu', true),
    ];

    expect(rankWardMatches(rows, 20, collator).map((ward) => ward.code)).toEqual([
      // `Bà Mẫu` sorts before `Ba Mẫu Đình`: tone marks weigh only between equal letters.
      '90001',
      '90009',
      '90002',
      '90004',
      '90003',
      '90005',
    ]);
  });

  it('maps a row to { code, provinceCode, name, type } with names.vi as name', () => {
    expect(rankWardMatches([match('90001', 'Bến Mẫu', false, 'COMMUNE')], 20, collator)).toEqual([
      { code: '90001', provinceCode: '90', name: 'Bến Mẫu', type: 'COMMUNE' },
    ]);
  });

  it('cuts the ranked list to the limit', () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      match(String(90001 + index), `Mẫu ${String(index).padStart(2, '0')}`, false),
    );

    const ranked = rankWardMatches(rows, 20, collator);

    expect(ranked).toHaveLength(20);
    expect(ranked[0]?.code).toBe('90001');
  });
});

describe('GeoService.searchWards', () => {
  function searchingDataSource(rows: readonly WardMatch[]) {
    const query = vi.fn(async () => [...rows]);
    return { dataSource: { query } as unknown as DataSource, query };
  }

  it('escapes LIKE wildcards in q and trims it', async () => {
    const { dataSource, query } = searchingDataSource([]);

    await new GeoService(dataSource).searchWards({
      provinceCode: '90',
      q: '  10%_a\\ ',
      limit: 20,
    });

    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('public.kd_unaccent');
    expect(sql).toContain("ESCAPE '\\'");
    expect(parameters).toEqual(['90', '10\\%\\_a\\\\', null]);
  });

  it('sends no q filter for a blank q and the ids without duplicates', async () => {
    const { dataSource, query } = searchingDataSource([]);

    await new GeoService(dataSource).searchWards({
      provinceCode: '90',
      q: '   ',
      limit: 20,
      ids: ['90002', '90001', '90002'],
    });

    const [, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(parameters).toEqual(['90', null, ['90002', '90001']]);
  });

  it('answers the ranked rows, cut to the limit', async () => {
    const { dataSource } = searchingDataSource([
      match('90002', 'An Mẫu', false),
      match('90001', 'Ba Mẫu', true),
    ]);

    await expect(
      new GeoService(dataSource).searchWards({ provinceCode: '90', q: 'ba', limit: 1 }),
    ).resolves.toEqual([{ code: '90001', provinceCode: '90', name: 'Ba Mẫu', type: 'WARD' }]);
  });
});
