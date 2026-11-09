import { Column, Entity, PrimaryColumn } from 'typeorm';

/** `names`: an object of short labels with a required `vi` key (`CHECK names ? 'vi'`). */
export type AmenityNames = { readonly vi: string } & Readonly<Record<string, string>>;

/**
 * One row of `public.amenities` (migration `0013_branch_details.sql`; data-model `amenities`): an
 * admin-managed amenity. `icon` is a key of the API's fixed list (brief B32). `rowVersion` and
 * `updatedAt` are set by triggers. Columns state `type` and `name` explicitly (decision 0007
 * sections 2 and 8).
 */
@Entity({ name: 'amenities', schema: 'public' })
export class Amenity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({ type: 'text', name: 'code' })
  code!: string;

  @Column({ type: 'jsonb', name: 'names' })
  names!: AmenityNames;

  @Column({ type: 'text', name: 'icon' })
  icon!: string;

  /** Plain integer, bumped by trigger; never `@VersionColumn` (decision 0007 section 8). */
  @Column({ type: 'integer', name: 'row_version', default: 1 })
  rowVersion!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
