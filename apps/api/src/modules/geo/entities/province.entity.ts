import { Column, Entity, PrimaryColumn } from 'typeorm';

/** `public.province_type` (migration `0009_geography.sql`). */
export const PROVINCE_TYPES = ['CITY', 'PROVINCE'] as const;
export type ProvinceType = (typeof PROVINCE_TYPES)[number];

/**
 * `names`: `vi` is required (`CHECK names ? 'vi'`); `vi_full`, the official full name, is a
 * documented key (ADR-0008 #17) that the seed always writes.
 */
export type AdminUnitNames = { readonly vi: string; readonly vi_full?: string } & Readonly<
  Record<string, string>
>;

/**
 * One row of `public.provinces` (migration `0009_geography.sql`; data-model "Geography"). Reference
 * data: written by `seed reference` as `kd_migrator`, read only for `kd_app`. Columns state `type`
 * and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'provinces', schema: 'public' })
export class Province {
  /** Official code, 2 digits, as text. */
  @PrimaryColumn({ type: 'text', name: 'code' })
  code!: string;

  @Column({ type: 'jsonb', name: 'names' })
  names!: AdminUnitNames;

  @Column({ type: 'enum', name: 'type', enum: PROVINCE_TYPES, enumName: 'province_type' })
  type!: ProvinceType;
}
