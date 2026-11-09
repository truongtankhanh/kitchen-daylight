import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Relation } from 'typeorm';

import { Branch } from './branch.entity.js';

/**
 * One row of `public.delivery_zones` (migration `0013_branch_details.sql`; data-model
 * `delivery_zones`): a delivery ring of a branch. Money is integer VND (`vnd` domain).
 * `rowVersion` and `updatedAt` are set by triggers. Columns state `type` and `name` explicitly
 * (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'delivery_zones', schema: 'public' })
export class DeliveryZone {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'branch_id' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'branch_id', referencedColumnName: 'id' })
  branch?: Relation<Branch>;

  @Column({ type: 'text', name: 'name' })
  name!: string;

  /** Straight-line radius in metres; unique per branch among active zones. */
  @Column({ type: 'integer', name: 'radius_m' })
  radiusM!: number;

  /** `vnd` domain. */
  @Column({ type: 'integer', name: 'fee' })
  fee!: number;

  /** `vnd` domain; compared with the subtotal before any discount. */
  @Column({ type: 'integer', name: 'min_order' })
  minOrder!: number;

  /** `vnd` domain, above `minOrder`; null when delivery is never free. */
  @Column({ type: 'integer', name: 'free_over', nullable: true })
  freeOver!: number | null;

  @Column({ type: 'integer', name: 'eta_minutes' })
  etaMinutes!: number;

  @Column({ type: 'boolean', name: 'is_active' })
  isActive!: boolean;

  /** Plain integer, bumped by trigger; never `@VersionColumn` (decision 0007 section 8). */
  @Column({ type: 'integer', name: 'row_version', default: 1 })
  rowVersion!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
