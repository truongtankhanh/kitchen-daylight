import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { MenuNames } from './menu-category.entity.js';

/** `public.tag_kind` (migration `0015_menu.sql`). */
export const TAG_KINDS = ['DIETARY', 'ALLERGEN', 'LABEL'] as const;
export type TagKind = (typeof TAG_KINDS)[number];

/**
 * One row of `public.tags` (migration `0015_menu.sql`; data-model `tags`): a dietary, allergen or
 * label tag. A tag in use cannot be deleted (`menu_item_tags.tag_id` `RESTRICT`). `rowVersion` and
 * `updatedAt` are set by triggers. Columns state `type` and `name` explicitly (decision 0007
 * sections 2 and 8).
 */
@Entity({ name: 'tags', schema: 'public' })
export class Tag {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'enum', name: 'kind', enum: TAG_KINDS, enumName: 'tag_kind' })
  kind!: TagKind;

  @Column({ type: 'text', name: 'slug' })
  slug!: string;

  @Column({ type: 'jsonb', name: 'names' })
  names!: MenuNames;

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
