import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { Point } from 'typeorm';

/** `public.branch_status` (migration `0007_users_branches_staff.sql`). */
export const BRANCH_STATUSES = ['ACTIVE', 'TEMPORARILY_CLOSED', 'CLOSED'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

/** `description`: translations with a required `vi` key (`CHECK description ? 'vi'`). */
export type BranchDescription = { readonly vi: string } & Readonly<Record<string, string>>;

/**
 * One row of `public.branches` (migration `0007_users_branches_staff.sql`). Columns state `type`
 * and `name` explicitly (decision 0007 sections 2 and 8). `rowVersion` and `updatedAt` are set by
 * triggers; `reviewCount` and `ratingSum` are background counters that move neither.
 */
@Entity({ name: 'branches', schema: 'public' })
export class Branch {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text', name: 'code' })
  code!: string;

  @Column({ type: 'text', name: 'slug' })
  slug!: string;

  @Column({ type: 'text', name: 'name' })
  name!: string;

  @Column({ type: 'jsonb', name: 'description', nullable: true })
  description!: BranchDescription | null;

  @Column({ type: 'text', name: 'address_line' })
  addressLine!: string;

  /** Foreign key to `provinces` added by A2-T3. */
  @Column({ type: 'text', name: 'province_code' })
  provinceCode!: string;

  /** Foreign key to `wards` added by A2-T3. */
  @Column({ type: 'text', name: 'ward_code', nullable: true })
  wardCode!: string | null;

  /** `geography(Point, 4326)`: GeoJSON `[longitude, latitude]`. */
  @Column({ type: 'geography', name: 'location', spatialFeatureType: 'Point', srid: 4326 })
  location!: Point;

  /** `e164_phone` domain. */
  @Column({ type: 'text', name: 'phone' })
  phone!: string;

  @Column({ type: 'enum', name: 'status', enum: BRANCH_STATUSES, enumName: 'branch_status' })
  status!: BranchStatus;

  @Column({ type: 'boolean', name: 'accepts_pickup' })
  acceptsPickup!: boolean;

  @Column({ type: 'boolean', name: 'accepts_delivery' })
  acceptsDelivery!: boolean;

  @Column({ type: 'boolean', name: 'accepts_reservations' })
  acceptsReservations!: boolean;

  @Column({ type: 'integer', name: 'default_prep_minutes' })
  defaultPrepMinutes!: number;

  @Column({ type: 'integer', name: 'order_cutoff_minutes' })
  orderCutoffMinutes!: number;

  @Column({ type: 'integer', name: 'reservation_duration_minutes', default: 90 })
  reservationDurationMinutes!: number;

  @Column({ type: 'integer', name: 'reservation_slot_step_minutes' })
  reservationSlotStepMinutes!: number;

  @Column({ type: 'integer', name: 'reservation_max_party' })
  reservationMaxParty!: number;

  @Column({ type: 'integer', name: 'reservation_lead_minutes' })
  reservationLeadMinutes!: number;

  @Column({ type: 'integer', name: 'reservation_max_days_ahead' })
  reservationMaxDaysAhead!: number;

  /** Foreign key to `media` added by A6. */
  @Column({ type: 'uuid', name: 'cover_media_id', nullable: true })
  coverMediaId!: string | null;

  @Column({ type: 'text', name: 'website_url', nullable: true })
  websiteUrl!: string | null;

  @Column({ type: 'text', name: 'pause_message', nullable: true })
  pauseMessage!: string | null;

  @Column({ type: 'integer', name: 'sort_order' })
  sortOrder!: number;

  @Column({ type: 'integer', name: 'review_count', default: 0 })
  reviewCount!: number;

  @Column({ type: 'integer', name: 'rating_sum', default: 0 })
  ratingSum!: number;

  /** Plain integer, bumped by trigger; never `@VersionColumn` (decision 0007 section 8). */
  @Column({ type: 'integer', name: 'row_version', default: 1 })
  rowVersion!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  /** References `users`; null for a system change (brief C10). */
  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
