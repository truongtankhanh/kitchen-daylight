import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PROVINCE_CODE_INPUT_MAX_LENGTH } from '../../geo/dto/list-wards-query.dto.js';

// Provisional lengths the documents do not state (api-divergences D-063); the same limits are
// `CHECK`s of migration `0010_customer_addresses.sql`.
export const ADDRESS_LABEL_MAX_LENGTH = 40;
export const ADDRESS_RECIPIENT_NAME_MAX_LENGTH = 60;
export const ADDRESS_LINE_MAX_LENGTH = 200;
/** Mobile G46; `customer_addresses_note_length`. */
export const ADDRESS_DELIVERY_NOTE_MAX_LENGTH = 200;
/** Longer than any official code (5 digits), so an unknown code reaches the lookup. */
export const WARD_CODE_INPUT_MAX_LENGTH = 16;

const FINITE = { allowNaN: false, allowInfinity: false } as const;

/** The map pin: WGS 84 degrees. Out of range is `OUT_OF_RANGE`. */
export class AddressLocationInputDto {
  /** Latitude, -90 to 90. */
  @ApiProperty({ type: 'number', format: 'double', example: 10.7769 })
  @IsDefined()
  @IsNumber(FINITE)
  @Min(-90)
  @Max(90)
  lat!: number;

  /** Longitude, -180 to 180. */
  @ApiProperty({ type: 'number', format: 'double', example: 106.7009 })
  @IsDefined()
  @IsNumber(FINITE)
  @Min(-180)
  @Max(180)
  lng!: number;
}

/**
 * `POST /api/v1/me/addresses`. Text fields are trimmed; a blank one is `REQUIRED`. Any other
 * property, a user id included, is refused by the global pipe.
 */
export class AddressCreateDto {
  /** The customer's name for the address (for example `Nhà`), 1 to 40 characters. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(ADDRESS_LABEL_MAX_LENGTH)
  label!: string;

  /** 1 to 60 characters. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(ADDRESS_RECIPIENT_NAME_MAX_LENGTH)
  recipientName!: string;

  /**
   * A Vietnamese mobile number in national (`0…`) or international (`+84…`, `84…`) form, stored in
   * E.164; anything else is `INVALID_PHONE`.
   */
  @ApiProperty({ example: '0901234567' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  phone!: string;

  /** Street, number and building, 1 to 200 characters. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(ADDRESS_LINE_MAX_LENGTH)
  addressLine!: string;

  /** Official code from `GET /api/v1/provinces`; an unknown one is `NOT_FOUND` on this field. */
  @ApiProperty({ example: '79' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PROVINCE_CODE_INPUT_MAX_LENGTH)
  provinceCode!: string;

  /**
   * Official code from `GET /api/v1/wards?provinceCode=`; unknown or outside `provinceCode` is
   * `NOT_FOUND` on this field. Missing or `null`: no ward.
   */
  @ApiProperty({ type: String, nullable: true, required: false, example: '26743' })
  @ValidateIf((dto: AddressCreateDto) => dto.wardCode !== undefined && dto.wardCode !== null)
  @IsString()
  @MaxLength(WARD_CODE_INPUT_MAX_LENGTH)
  wardCode?: string | null;

  /** The pin the customer dropped; required (no geocoding for customers, mobile G48). */
  @ApiProperty({ type: AddressLocationInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AddressLocationInputDto)
  location!: AddressLocationInputDto;

  /** At most 200 characters (`TOO_LONG`; mobile G46). Missing, `null` or blank: no note. */
  @ApiProperty({ type: String, nullable: true, required: false })
  @ValidateIf(
    (dto: AddressCreateDto) => dto.deliveryNote !== undefined && dto.deliveryNote !== null,
  )
  @IsString()
  @MaxLength(ADDRESS_DELIVERY_NOTE_MAX_LENGTH)
  deliveryNote?: string | null;

  /** `true` makes this the default and clears the previous one. Default `false`. */
  @ApiProperty({ required: false })
  @ValidateIf((dto: AddressCreateDto) => dto.isDefault !== undefined)
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * `PATCH /api/v1/me/addresses/{id}`: every field is optional and a missing one is left as it is.
 * `wardCode` and `deliveryNote` take `null` to clear; the other fields do not. `isDefault: false`
 * unsets the default without choosing another one.
 */
export class AddressUpdateDto {
  /** 1 to 40 characters. */
  @ValidateIf((dto: AddressUpdateDto) => dto.label !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(ADDRESS_LABEL_MAX_LENGTH)
  label?: string;

  /** 1 to 60 characters. */
  @ValidateIf((dto: AddressUpdateDto) => dto.recipientName !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(ADDRESS_RECIPIENT_NAME_MAX_LENGTH)
  recipientName?: string;

  /** National or international form, stored in E.164; anything else is `INVALID_PHONE`. */
  @ApiProperty({ required: false, example: '0901234567' })
  @ValidateIf((dto: AddressUpdateDto) => dto.phone !== undefined)
  @IsNotEmpty()
  @IsString()
  phone?: string;

  /** 1 to 200 characters. */
  @ValidateIf((dto: AddressUpdateDto) => dto.addressLine !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(ADDRESS_LINE_MAX_LENGTH)
  addressLine?: string;

  /**
   * Official province code. The ward kept or sent must belong to it (`NOT_FOUND` on `wardCode`
   * otherwise).
   */
  @ApiProperty({ required: false, example: '79' })
  @ValidateIf((dto: AddressUpdateDto) => dto.provinceCode !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(PROVINCE_CODE_INPUT_MAX_LENGTH)
  provinceCode?: string;

  /** Official ward code inside the province, or `null` to clear. */
  @ApiProperty({ type: String, nullable: true, required: false, example: '26743' })
  @ValidateIf((dto: AddressUpdateDto) => dto.wardCode !== undefined && dto.wardCode !== null)
  @IsString()
  @MaxLength(WARD_CODE_INPUT_MAX_LENGTH)
  wardCode?: string | null;

  /** A new pin; `null` is refused (the pin is required). */
  @ApiProperty({ type: AddressLocationInputDto, required: false })
  @ValidateIf((dto: AddressUpdateDto) => dto.location !== undefined)
  @IsDefined()
  @ValidateNested()
  @Type(() => AddressLocationInputDto)
  location?: AddressLocationInputDto;

  /** At most 200 characters; `null` or blank clears it. */
  @ApiProperty({ type: String, nullable: true, required: false })
  @ValidateIf(
    (dto: AddressUpdateDto) => dto.deliveryNote !== undefined && dto.deliveryNote !== null,
  )
  @IsString()
  @MaxLength(ADDRESS_DELIVERY_NOTE_MAX_LENGTH)
  deliveryNote?: string | null;

  /** `true` makes this the default and clears the previous one; `false` unsets it. */
  @ApiProperty({ required: false })
  @ValidateIf((dto: AddressUpdateDto) => dto.isDefault !== undefined)
  @IsBoolean()
  isDefault?: boolean;
}
