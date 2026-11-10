import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A `names jsonb` column of the menu tables: short labels with a required `vi` key
 * (`CHECK names ? 'vi'` and `jsonb_typeof(names) = 'object'`).
 */
export type MenuNames = { readonly vi: string } & Readonly<Record<string, string>>;

/**
 * One row of `public.menu_categories` (migration `0015_menu.sql`; data-model `menu_categories`): a
 * category shared by all branches. `icon` is a key of the API's list (mobile G6). `rowVersion` and
 * `updatedAt` are set by triggers. Columns state `type` and `name` explicitly (decision 0007
 * sections 2 and 8).
 */
@Entity({ name: 'menu_categories', schema: 'public' })
export class MenuCategory {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text', name: 'slug' })
  slug!: string;

  @Column({ type: 'jsonb', name: 'names' })
  names!: MenuNames;

  @Column({ type: 'text', name: 'icon', nullable: true })
  icon!: string | null;

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

  /** References `users`; null for a system change (decision 0007 row 8). */
  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
