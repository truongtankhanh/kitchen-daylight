import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { BRANCH_SERVICES } from './branch-opening-period.entity.js';
import type { BranchService } from './branch-opening-period.entity.js';
import { Branch } from './branch.entity.js';

/**
 * One row of `public.branch_special_hours` (migration `0013_branch_details.sql`; data-model
 * `branch_special_hours`): a date range that overrides the weekly periods. A closed range has no
 * times; an open one has all three (api-divergences D-128). Replaced as a whole list, no
 * timestamps. Columns state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'branch_special_hours', schema: 'public' })
export class BranchSpecialHours {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', referencedColumnName: 'id' })
  branch?: Relation<Branch>;

  @Column({ type: 'enum', name: 'service', enum: BRANCH_SERVICES, enumName: 'branch_service' })
  service!: BranchService;

  /** `date`, read as `YYYY-MM-DD`. */
  @Column({ type: 'date', name: 'starts_on' })
  startsOn!: string;

  /** On or after `startsOn`; the range includes both days. */
  @Column({ type: 'date', name: 'ends_on' })
  endsOn!: string;

  @Column({ type: 'boolean', name: 'is_closed' })
  isClosed!: boolean;

  /** `time`, read as `HH:MM:SS`; null exactly when `isClosed`. */
  @Column({ type: 'time', name: 'open_time', nullable: true })
  openTime!: string | null;

  @Column({ type: 'time', name: 'close_time', nullable: true })
  closeTime!: string | null;

  @Column({ type: 'boolean', name: 'closes_next_day', nullable: true })
  closesNextDay!: boolean | null;

  /** Internal; never shown to customers (brief C13). */
  @Column({ type: 'text', name: 'note', nullable: true })
  note!: string | null;

  /** Customer-facing text (mobile G12). */
  @Column({ type: 'text', name: 'display_note', nullable: true })
  displayNote!: string | null;
}
