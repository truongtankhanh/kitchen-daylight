import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Branch } from './branch.entity.js';

/** `public.branch_service` (migration `0013_branch_details.sql`). */
export const BRANCH_SERVICES = ['STORE', 'DELIVERY'] as const;
export type BranchService = (typeof BRANCH_SERVICES)[number];

/**
 * One row of `public.branch_opening_periods` (migration `0013_branch_details.sql`; data-model
 * `branch_opening_periods`): one weekly period of a branch and service. Replaced as a whole list,
 * no timestamps. Columns state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'branch_opening_periods', schema: 'public' })
export class BranchOpeningPeriod {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', referencedColumnName: 'id' })
  branch?: Relation<Branch>;

  @Column({ type: 'enum', name: 'service', enum: BRANCH_SERVICES, enumName: 'branch_service' })
  service!: BranchService;

  /** 1 to 7, Monday = 1. */
  @Column({ type: 'integer', name: 'day_of_week' })
  dayOfWeek!: number;

  /** `time`, read as `HH:MM:SS`. */
  @Column({ type: 'time', name: 'open_time' })
  openTime!: string;

  /** At or before `openTime` exactly when `closesNextDay`. */
  @Column({ type: 'time', name: 'close_time' })
  closeTime!: string;

  @Column({ type: 'boolean', name: 'closes_next_day' })
  closesNextDay!: boolean;
}
