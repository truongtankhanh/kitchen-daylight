import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Media } from '../../media/entities/media.entity.js';
import { MenuItem } from './menu-item.entity.js';

/**
 * One row of `public.menu_item_media` (migration `0015_menu.sql`; data-model `menu_item_media`): a
 * photo of an item; `position` 0 is the cover. (`menuItemId`, `position`) is unique and deferred, so
 * the list is rewritten in one transaction. Columns state `type` and `name` explicitly (decision
 * 0007 sections 2 and 8).
 */
@Entity({ name: 'menu_item_media', schema: 'public' })
export class MenuItemMedia {
  @PrimaryColumn({ type: 'uuid', name: 'menu_item_id' })
  menuItemId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'media_id' })
  mediaId!: string;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'menu_item_id', referencedColumnName: 'id' })
  menuItem?: Relation<MenuItem>;

  /** `RESTRICT`: an image in use is never deleted. */
  @ManyToOne(() => Media, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'media_id', referencedColumnName: 'id' })
  media?: Relation<Media>;

  @Column({ type: 'integer', name: 'position' })
  position!: number;
}
