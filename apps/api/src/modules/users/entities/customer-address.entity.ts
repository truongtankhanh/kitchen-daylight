import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Point, Relation } from 'typeorm';

import { Province } from '../../geo/entities/province.entity.js';
import { User } from './user.entity.js';

/**
 * One row of `public.customer_addresses` (migration `0010_customer_addresses.sql`; data-model
 * `customer_addresses`): a saved delivery address of a customer. Soft-deleted (`deleted_at`);
 * `kd_app` has `SELECT, INSERT, UPDATE` only. `AddressesService` reads and writes `location` with
 * SQL (`ST_SetSRID(ST_MakePoint(lng, lat), 4326)`, `ST_Y`, `ST_X`); the mapping is here for the
 * `DataSource` only. Columns state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'customer_addresses', schema: 'public' })
export class CustomerAddress {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: Relation<User>;

  @Column({ type: 'text', name: 'label' })
  label!: string;

  @Column({ type: 'text', name: 'recipient_name' })
  recipientName!: string;

  /** `e164_phone` domain. */
  @Column({ type: 'text', name: 'phone' })
  phone!: string;

  @Column({ type: 'text', name: 'address_line' })
  addressLine!: string;

  @Column({ type: 'text', name: 'province_code' })
  provinceCode!: string;

  @ManyToOne(() => Province, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'province_code', referencedColumnName: 'code' })
  province?: Relation<Province>;

  /** Belongs to `provinceCode` (composite foreign key on `wards (code, province_code)`). */
  @Column({ type: 'text', name: 'ward_code', nullable: true })
  wardCode!: string | null;

  /** `geography(Point, 4326)`: GeoJSON `[longitude, latitude]`. Never logged. */
  @Column({ type: 'geography', name: 'location', spatialFeatureType: 'Point', srid: 4326 })
  location!: Point;

  /** The delivery note, `deliveryNote` in the API (at most 200 characters; mobile G46). */
  @Column({ type: 'text', name: 'note', nullable: true })
  note!: string | null;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault!: boolean;

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
