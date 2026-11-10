import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { MenuCategory } from './menu-category.entity.js';

/**
 * One row of `public.menu_items` (migration `0015_menu.sql`; data-model `menu_items`): one dish for
 * the whole brand. Soft-deleted (`deletedAt`); `kd_app` has no `DELETE`. Money is integer VND
 * (`vnd` domain). `rowVersion` and `updatedAt` are set by triggers. Columns state `type` and `name`
 * explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'menu_items', schema: 'public' })
export class MenuItem {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text', name: 'slug' })
  slug!: string;

  @Column({ type: 'uuid', name: 'category_id' })
  categoryId!: string;

  /** `RESTRICT`: a category in use cannot be deleted (brief B25). */
  @ManyToOne(() => MenuCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id', referencedColumnName: 'id' })
  category?: Relation<MenuCategory>;

  /** `vnd` domain; above 0 to be active (API, brief B8). */
  @Column({ type: 'integer', name: 'base_price' })
  basePrice!: number;

  /** Above 0 when set; null uses the branch `default_prep_minutes`. */
  @Column({ type: 'integer', name: 'prep_minutes', nullable: true })
  prepMinutes!: number | null;

  @Column({ type: 'integer', name: 'sort_order' })
  sortOrder!: number;

  @Column({ type: 'boolean', name: 'is_active' })
  isActive!: boolean;

  /** Plain integer, bumped by trigger; never `@VersionColumn` (decision 0007 section 8). */
  @Column({ type: 'integer', name: 'row_version', default: 1 })
  rowVersion!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  /** References `users`; null for a system change (brief B1). */
  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
