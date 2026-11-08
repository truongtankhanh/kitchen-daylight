import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The storage keys of `app_settings.key` (migration `0011_app_settings.sql`, CHECK
 * `app_settings_key_known`), in data-model order. `reservations` is phase 2 (A14).
 */
export const SETTING_STORAGE_KEYS = [
  'brand',
  'reports',
  'min_app_version',
  'maintenance',
  'feature_flags',
  'payment',
  'ordering',
  'loyalty',
] as const;
export type SettingStorageKey = (typeof SETTING_STORAGE_KEYS)[number];

/**
 * One row of `public.app_settings` (migration `0011_app_settings.sql`). `value` holds the snake_case
 * object of data-model; the schema of each key maps it to the camelCase API shape. `rowVersion` and
 * `updatedAt` are set by triggers. Columns state `type` and `name` explicitly (decision 0007
 * sections 2 and 8).
 */
@Entity({ name: 'app_settings', schema: 'public' })
export class AppSetting {
  @PrimaryColumn({ type: 'text', name: 'key' })
  key!: SettingStorageKey;

  @Column({ type: 'jsonb', name: 'value' })
  value!: object;

  @Column({ type: 'integer', name: 'row_version', default: 1 })
  rowVersion!: number;

  /** References `users`; null for a row written by the seed. */
  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
