import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Province } from './province.entity.js';
import type { AdminUnitNames } from './province.entity.js';

/** `public.ward_type` (migration `0009_geography.sql`). */
export const WARD_TYPES = ['WARD', 'COMMUNE', 'SPECIAL_ZONE'] as const;
export type WardType = (typeof WARD_TYPES)[number];

/**
 * One row of `public.wards` (migration `0009_geography.sql`; data-model "Geography"): a
 * commune-level unit, with no district level. Unique on (`code`, `provinceCode`), the target of the
 * composite foreign keys that tie a ward to its province. Reference data, read only for `kd_app`.
 */
@Entity({ name: 'wards', schema: 'public' })
export class Ward {
  /** Official code, 5 digits, as text; unique across the country. */
  @PrimaryColumn({ type: 'text', name: 'code' })
  code!: string;

  @Column({ type: 'text', name: 'province_code' })
  provinceCode!: string;

  @ManyToOne(() => Province, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'province_code', referencedColumnName: 'code' })
  province?: Relation<Province>;

  @Column({ type: 'jsonb', name: 'names' })
  names!: AdminUnitNames;

  @Column({ type: 'enum', name: 'type', enum: WARD_TYPES, enumName: 'ward_type' })
  type!: WardType;
}
