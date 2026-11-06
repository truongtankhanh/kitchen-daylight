import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Longest email accepted (RFC 5321 path limit). */
export const EMAIL_MAX_LENGTH = 254;
/** Cheap guard on the raw password before NFC and the code-point policy (decision 0008 section 4). */
export const PASSWORD_INPUT_MAX_LENGTH = 1024;
/** `users.display_name` (data-model, `CHECK`; mobile G95). */
export const DISPLAY_NAME_MAX_LENGTH = 60;
/**
 * Provisional bound on the `deviceLabel` input (api-divergences D-046); the stored label is then cut
 * to 60 code points by `normalizeDeviceLabel` (decision 0008 section 1).
 */
export const DEVICE_LABEL_INPUT_MAX_LENGTH = 80;
/** More ids than legal document types exist; bounds the array before the lookup. */
export const ACCEPTED_DOCUMENT_IDS_MAX = 10;

/** `POST /api/v1/auth/register`. */
export class RegisterDto {
  /**
   * Trimmed and lower-cased before it is stored. Trimmed here, before validation, because
   * `@IsEmail()` refuses surrounding whitespace that a keyboard or autofill may add.
   */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsDefined()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  /** 10 to 128 Unicode code points after NFC; not the email or its local part. */
  @ApiProperty({ format: 'password' })
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(PASSWORD_INPUT_MAX_LENGTH)
  password!: string;

  /** At most 60 characters, trimmed. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  /**
   * Optional at registration. A Vietnamese mobile number, national (`0…`) or international (`+84…`,
   * `84…`) form; stored in E.164.
   */
  @IsOptional()
  @IsString()
  phone?: string | null;

  /** Exactly the ids of the current Terms of Service and Privacy Policy (locale `vi`). */
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(ACCEPTED_DOCUMENT_IDS_MAX)
  @IsUUID('all', { each: true })
  acceptedDocumentIds!: string[];

  /** Shown in the session list; display only. Defaults to `X-Client`. */
  @IsOptional()
  @IsString()
  @MaxLength(DEVICE_LABEL_INPUT_MAX_LENGTH)
  deviceLabel?: string | null;
}
