import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import { PROVINCE_TYPES } from '../entities/province.entity.js';
import type { ProvinceType } from '../entities/province.entity.js';
import { WARD_TYPES } from '../entities/ward.entity.js';
import type { WardType } from '../entities/ward.entity.js';
import type { AdminUnitView } from '../geo.service.js';

/** One item of `GET /api/v1/provinces` (shape logged as api-divergences D-055). */
@ApiSchema({ name: 'Province' })
export class ProvinceDto implements AdminUnitView<ProvinceType> {
  /** Official code, 2 digits, as text (for example `79`). */
  @ApiProperty({ example: '79' })
  code!: string;

  /** `names.vi`: the short name without the type prefix (for example `Hồ Chí Minh`). */
  name!: string;

  /** `names.vi_full`: the official full name (for example `Thành phố Hồ Chí Minh`). */
  fullName!: string;

  @ApiProperty({ enum: PROVINCE_TYPES, enumName: 'ProvinceType' })
  type!: ProvinceType;
}

/** One item of `GET /api/v1/wards` (shape logged as api-divergences D-055). */
@ApiSchema({ name: 'Ward' })
export class WardDto implements AdminUnitView<WardType> {
  /** Official code, 5 digits, as text, unique across the country (for example `26743`). */
  @ApiProperty({ example: '26743' })
  code!: string;

  /** `names.vi`: the short name without the type prefix (for example `Bến Thành`). */
  name!: string;

  /** `names.vi_full`: the official full name (for example `Phường Bến Thành`). */
  fullName!: string;

  @ApiProperty({ enum: WARD_TYPES, enumName: 'WardType' })
  type!: WardType;
}
