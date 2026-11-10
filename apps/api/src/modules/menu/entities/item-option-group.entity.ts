import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import type { MenuNames } from './menu-category.entity.js';
import { MenuItem } from './menu-item.entity.js';

/**
 * One row of `public.item_option_groups` (migration `0015_menu.sql`; data-model
 * `item_option_groups`): an option group of one item, `0 <= minSelect <= maxSelect` (`CHECK`).
 * Columns state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'item_option_groups', schema: 'public' })
export class ItemOptionGroup {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id', referencedColumnName: 'id' })
  menuItem?: Relation<MenuItem>;

  @Column({ type: 'jsonb', name: 'names' })
  names!: MenuNames;

  @Column({ type: 'integer', name: 'min_select' })
  minSelect!: number;

  @Column({ type: 'integer', name: 'max_select' })
  maxSelect!: number;

  @Column({ type: 'integer', name: 'sort_order' })
  sortOrder!: number;
}
