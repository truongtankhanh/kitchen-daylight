import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Branch } from '../../branches/entities/branch.entity.js';
import { MenuItem } from './menu-item.entity.js';

/**
 * One row of `public.branch_menu_items` (migration `0015_menu.sql`; data-model
 * `branch_menu_items`): an item a branch sells. No row means the branch does not offer it. Money is
 * integer VND (`vnd` domain). `rowVersion` and `updatedAt` are set by triggers, which leave out
 * `stockQty` (changed by every order). Columns state `type` and `name` explicitly (decision 0007
 * sections 2 and 8).
 */
@Entity({ name: 'branch_menu_items', schema: 'public' })
export class BranchMenuItem {
  @PrimaryColumn({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', referencedColumnName: 'id' })
  branch?: Relation<Branch>;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id', referencedColumnName: 'id' })
  menuItem?: Relation<MenuItem>;

  @Column({ type: 'boolean', name: 'is_available' })
  isAvailable!: boolean;

  /** `vnd` domain, above 0; null uses `menu_items.base_price`. */
  @Column({ type: 'integer', name: 'price_override', nullable: true })
  priceOverride!: number | null;

  /** 0 or more; null when stock is not tracked. */
  @Column({ type: 'integer', name: 'stock_qty', nullable: true })
  stockQty!: number | null;

  /** 0 or more; null never means low (brief F7). */
  @Column({ type: 'integer', name: 'low_stock_threshold', nullable: true })
  lowStockThreshold!: number | null;

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
