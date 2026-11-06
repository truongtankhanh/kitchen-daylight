import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Branch } from '../../branches/entities/branch.entity.js';
import { User } from './user.entity.js';

/**
 * One row of `public.staff_branches` (migration `0007_users_branches_staff.sql`): a branch a
 * `STAFF` or `MANAGER` works at. Inserted and deleted, never updated. Columns state `type` and
 * `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'staff_branches', schema: 'public' })
export class StaffBranch {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: Relation<User>;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', referencedColumnName: 'id' })
  branch?: Relation<Branch>;
}
