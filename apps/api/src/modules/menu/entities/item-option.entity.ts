import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { ItemOptionGroup } from './item-option-group.entity.js';
import type { MenuNames } from './menu-category.entity.js';

/**
 * One row of `public.item_options` (migration `0015_menu.sql`; data-model `item_options`): a choice
 * inside an option group. Money is integer VND (`vnd` domain). Columns state `type` and `name`
 * explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'item_options', schema: 'public' })
export class ItemOption {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => ItemOptionGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
  group?: Relation<ItemOptionGroup>;

  @Column({ type: 'jsonb', name: 'names' })
  names!: MenuNames;

  /** `vnd` domain, 0 or more; added to the item price. */
  @Column({ type: 'integer', name: 'price_delta' })
  priceDelta!: number;

  @Column({ type: 'boolean', name: 'is_default' })
  isDefault!: boolean;

  @Column({ type: 'boolean', name: 'is_active' })
  isActive!: boolean;

  @Column({ type: 'integer', name: 'sort_order' })
  sortOrder!: number;
}
