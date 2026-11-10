import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { MenuItem } from './menu-item.entity.js';

/**
 * One row of `public.menu_item_translations` (migration `0015_menu.sql`; data-model
 * `menu_item_translations`): the name (1 to 120 characters) and description (at most 2000) of an
 * item in one locale. No timestamps: the parent item records the edit (brief B1). Columns state
 * `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'menu_item_translations', schema: 'public' })
export class MenuItemTranslation {
  @PrimaryColumn({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @PrimaryColumn({ type: 'text', name: 'locale' })
  locale!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id', referencedColumnName: 'id' })
  menuItem?: Relation<MenuItem>;

  @Column({ type: 'text', name: 'name' })
  name!: string;

  @Column({ type: 'text', name: 'description', nullable: true })
  description!: string | null;
}
