import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Media } from '../../media/entities/media.entity.js';
import { Branch } from './branch.entity.js';

/**
 * One row of `public.branch_media` (migration `0015_menu.sql`; data-model `branch_media`): a photo
 * of a branch; `position` 0 is the cover, kept equal to `branches.cover_media_id` by the API (brief
 * C29). (`branchId`, `position`) is unique and deferred, so the gallery is rewritten in one
 * transaction (brief C30). Columns state `type` and `name` explicitly (decision 0007 sections 2
 * and 8).
 */
@Entity({ name: 'branch_media', schema: 'public' })
export class BranchMedia {
  @PrimaryColumn({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'media_id' })
  mediaId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', referencedColumnName: 'id' })
  branch?: Relation<Branch>;

  /** `RESTRICT`: an image in use is never deleted. */
  @ManyToOne(() => Media, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'media_id', referencedColumnName: 'id' })
  media?: Relation<Media>;

  @Column({ type: 'integer', name: 'position' })
  position!: number;
}
