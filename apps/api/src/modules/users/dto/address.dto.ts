import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import type { AddressPage, AddressView, GeoPoint } from '../addresses.service.js';

/** A map pin in WGS 84 degrees. */
@ApiSchema({ name: 'GeoPoint' })
export class GeoPointDto implements GeoPoint {
  @ApiProperty({ type: 'number', format: 'double', minimum: -90, maximum: 90, example: 10.7769 })
  lat!: number;

  @ApiProperty({ type: 'number', format: 'double', minimum: -180, maximum: 180, example: 106.7009 })
  lng!: number;
}

/** One saved delivery address of the signed-in customer (api-divergences D-064). */
@ApiSchema({ name: 'Address' })
export class AddressDto implements AddressView {
  /** The path parameter of `/me/addresses/{id}`. */
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** The customer's name for the address (for example `Nhà`). */
  label!: string;

  recipientName!: string;

  /** E.164 (for example `+84901234567`). */
  phone!: string;

  addressLine!: string;

  /** Official province code from `GET /api/v1/provinces`. */
  provinceCode!: string;

  /** Official ward code from `GET /api/v1/wards`, inside `provinceCode`; `null` when not chosen. */
  @ApiProperty({ type: String, nullable: true })
  wardCode!: string | null;

  @ApiProperty({ type: GeoPointDto })
  location!: GeoPointDto;

  /** At most 200 characters; `null` when none. */
  @ApiProperty({ type: String, nullable: true })
  deliveryNote!: string | null;

  /** At most one address of the customer is the default. */
  isDefault!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** `GET /api/v1/me/addresses`: an offset page (decision 0007 section 6; mobile G99). */
@ApiSchema({ name: 'AddressPage' })
export class AddressPageDto implements AddressPage {
  @ApiProperty({ type: AddressDto, isArray: true })
  items!: AddressDto[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;
}
