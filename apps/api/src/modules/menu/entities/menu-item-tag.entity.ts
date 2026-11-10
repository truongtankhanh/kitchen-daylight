import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { MenuItem } from './menu-item.entity.js';
import { Tag } from './tag.entity.js';

/**
 * One row of `public.menu_item_tags` (migration `0015_menu.sql`; data-model `menu_item_tags`): a tag
 * of an item. `verifiedAt` and `verifiedBy` are both null or both set (`CHECK`; brief B13). Columns
 * state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'menu_item_tags', schema: 'public' })
export class MenuItemTag {
  @PrimaryColumn({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'tag_id' })
  tagId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id', referencedColumnName: 'id' })
  menuItem?: Relation<MenuItem>;

  /** `RESTRICT`: a tag in use cannot be deleted (brief B24). */
  @ManyToOne(() => Tag, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tag_id', referencedColumnName: 'id' })
  tag?: Relation<Tag>;

  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt!: Date | null;

  /** References `users`: the `MANAGER` or `ADMIN` who confirmed the claim. */
  @Column({ type: 'uuid', name: 'verified_by', nullable: true })
  verifiedBy!: string | null;
}
