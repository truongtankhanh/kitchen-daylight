import { ApiSchema } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  ACCEPTED_DOCUMENT_IDS_MAX,
  DEVICE_LABEL_INPUT_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
} from '../../dto/register.dto.js';

/** Bound on the raw ID token before any parsing; real Google and Apple tokens are far shorter. */
export const ID_TOKEN_MAX_LENGTH = 8192;
/** Bound on the nonce input; the nonces of `NonceService` are under 100 characters. */
export const NONCE_INPUT_MAX_LENGTH = 256;

/** `POST /api/v1/me/identities/{provider}`: links a Google or Apple account to the signed-in user. */
@ApiSchema({ name: 'LinkSocialIdentity' })
export class LinkSocialIdentityDto {
  /** The ID token from the native Google or Apple flow. Never logged. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(ID_TOKEN_MAX_LENGTH)
  idToken!: string;

  /** The nonce from `POST /auth/social/nonce` that the token was requested with. */
  @IsDefined()
  @IsNotEmpty()
  @IsString()
  @MaxLength(NONCE_INPUT_MAX_LENGTH)
  nonce!: string;
}

/** `POST /api/v1/auth/social/google` and `POST /api/v1/auth/social/apple`. */
@ApiSchema({ name: 'SocialSignIn' })
export class SocialSignInDto extends LinkSocialIdentityDto {
  /**
   * Required only when the sign-in creates an account: exactly the ids of the current Terms of
   * Service and Privacy Policy (locale `vi`), as for register.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ACCEPTED_DOCUMENT_IDS_MAX)
  @IsUUID('all', { each: true })
  acceptedDocumentIds?: string[];

  /**
   * Used only when the sign-in creates an account. Apple gives the name to the app on the first
   * authorization only, never in the token, so the app sends it here. At most 60 characters.
   */
  @IsOptional()
  @IsString()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName?: string | null;

  /** Shown in the session list; display only. Defaults to `X-Client`. */
  @IsOptional()
  @IsString()
  @MaxLength(DEVICE_LABEL_INPUT_MAX_LENGTH)
  deviceLabel?: string | null;
}
