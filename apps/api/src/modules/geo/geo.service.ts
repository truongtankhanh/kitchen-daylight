import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import { Province } from './entities/province.entity.js';
import type { AdminUnitNames, ProvinceType } from './entities/province.entity.js';
import { Ward } from './entities/ward.entity.js';
import type { WardType } from './entities/ward.entity.js';

/** One administrative unit as the public endpoints return it (api-divergences D-055). */
export interface AdminUnitView<Type extends string> {
  readonly code: string;
  /** `names.vi`. */
  readonly name: string;
  /** `names.vi_full` (ADR-0008 #17), or `names.vi` on a row without it. */
  readonly fullName: string;
  readonly type: Type;
}

/**
 * Both lists change only when `seed reference` runs, so clients and shared caches may keep them for
 * a day; the `ETag` lets them revalidate cheaply after that.
 */
export const GEO_CACHE_CONTROL = 'public, max-age=86400';

export function toAdminUnitView<Type extends string>(row: {
  readonly code: string;
  readonly names: AdminUnitNames;
  readonly type: Type;
}): AdminUnitView<Type> {
  return {
    code: row.code,
    name: row.names.vi,
    fullName: row.names.vi_full ?? row.names.vi,
    type: row.type,
  };
}

/**
 * Sorts by Vietnamese name with `Intl.Collator('vi')` (so `Đ` follows `D` and tone marks do not
 * scatter the list), then by code, so that two units with the same short name keep a fixed order.
 */
export function sortAdminUnits<Unit extends AdminUnitView<string>>(
  units: readonly Unit[],
  collator: Intl.Collator,
): Unit[] {
  return [...units].sort(
    (a, b) => collator.compare(a.name, b.name) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
}

/**
 * A strong `ETag` of a JSON body: the SHA-256 of `JSON.stringify(body)`, the exact bytes Express
 * sends for it, so the tag changes exactly when the body does.
 */
export function strongEtag(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

/**
 * Provinces and wards for addresses (data-model "Geography"; api-outline, Public table). Reference
 * data, read only: the rows are written by `seed reference` (tools/seed). No in-memory cache, so a
 * re-seeded name shows without a restart; HTTP caching (`GEO_CACHE_CONTROL`, `ETag`) carries the
 * load instead.
 */
@Injectable()
export class GeoService {
  private readonly collator = new Intl.Collator('vi');

  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** Every province (34), sorted by name. No paging. */
  async listProvinces(): Promise<AdminUnitView<ProvinceType>[]> {
    const rows = await this.dataSource.getRepository(Province).find();
    return sortAdminUnits(rows.map(toAdminUnitView), this.collator);
  }

  /** Every ward of one province, sorted by name. `NOT_FOUND` for an unknown province. */
  async listWards(provinceCode: string): Promise<AdminUnitView<WardType>[]> {
    const rows = await this.dataSource.getRepository(Ward).find({ where: { provinceCode } });
    // Every province has wards, so the existence check runs only on an empty result.
    if (
      rows.length === 0 &&
      !(await this.dataSource.getRepository(Province).exists({ where: { code: provinceCode } }))
    ) {
      throw new ApiError('NOT_FOUND', { detail: 'Unknown province.' });
    }
    return sortAdminUnits(rows.map(toAdminUnitView), this.collator);
  }
}
