import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Amenity } from './amenity.entity.js';
import { Branch } from './branch.entity.js';

/**
 * One row of `public.branch_amenities` (migration `0013_branch_details.sql`; data-model
 * `branch_amenities`): an amenity a branch shows. Inserted and deleted, never updated. Columns
 * state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'branch_amenities', schema: 'public' })
export class BranchAmenity {
  @PrimaryColumn({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'amenity_id' })
  amenityId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', referencedColumnName: 'id' })
  branch?: Relation<Branch>;

  /** `RESTRICT`: an amenity in use cannot be deleted (brief B24). */
  @ManyToOne(() => Amenity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'amenity_id', referencedColumnName: 'id' })
  amenity?: Relation<Amenity>;
}
