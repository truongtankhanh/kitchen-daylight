import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { CONSENT_DOCUMENT_TYPES } from '../../users/entities/consent-document.entity.js';
import type { ConsentDocumentType } from '../../users/entities/consent-document.entity.js';
import type { ConsentDocumentView, CurrentDocumentsView } from '../legal.service.js';

/** A language tag such as `vi` or `en`; compared exactly with `consent_documents.locale`. */
export const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const LOCALE_INPUT_MAX_LENGTH = 35;

/** Query of `GET /api/v1/legal/documents/current`. */
export class CurrentDocumentsQueryDto {
  /** Locale of the documents; default `vi`. A locale with no published document falls back to `vi`. */
  @ApiProperty({ required: false, example: 'vi', default: 'vi' })
  @IsOptional()
  @IsString()
  @MaxLength(LOCALE_INPUT_MAX_LENGTH)
  @Matches(LOCALE_PATTERN)
  locale?: string;
}

/** One published Terms of Service or Privacy Policy (api-divergences D-120). */
@ApiSchema({ name: 'ConsentDocument' })
export class ConsentDocumentDto implements ConsentDocumentView {
  /** Send it in `acceptedDocumentIds` of `POST /auth/register`. */
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: CONSENT_DOCUMENT_TYPES, enumName: 'ConsentDocumentType' })
  type!: ConsentDocumentType;

  /** Free text, never compared; a version starting with `placeholder-` is not legal text. */
  version!: string;

  /** The locale of this text: `vi` when the requested locale has no document. */
  locale!: string;

  publishedAt!: Date;

  /** Lower-case hex SHA-256 of the UTF-8 bytes of `content`. */
  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  contentSha256!: string;

  /** The full text as published. */
  content!: string;
}

/** `GET /api/v1/legal/documents/current`: the Terms of Service, then the Privacy Policy. */
@ApiSchema({ name: 'CurrentConsentDocuments' })
export class CurrentDocumentsDto implements CurrentDocumentsView {
  @ApiProperty({ type: ConsentDocumentDto, isArray: true, minItems: 2, maxItems: 2 })
  documents!: ConsentDocumentDto[];
}
