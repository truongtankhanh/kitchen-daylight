import { ApiProperty, ApiSchema } from '@nestjs/swagger';

import { CONSENT_DOCUMENT_TYPES } from '../entities/consent-document.entity.js';
import type { ConsentDocumentType } from '../entities/consent-document.entity.js';
import { CONSENT_ACTIONS } from '../entities/user-consent.entity.js';
import type { ConsentAction } from '../entities/user-consent.entity.js';
import type { MyConsent } from '../me.service.js';

/** One item of `GET /api/v1/me/consents`: the latest consent event per document type. */
@ApiSchema({ name: 'MyConsent' })
export class MeConsentDto implements MyConsent {
  @ApiProperty({ format: 'uuid' })
  documentId!: string;

  @ApiProperty({ enum: CONSENT_DOCUMENT_TYPES, enumName: 'ConsentDocumentType' })
  type!: ConsentDocumentType;

  /** The document version the event refers to. */
  version!: string;

  locale!: string;

  @ApiProperty({ enum: CONSENT_ACTIONS, enumName: 'ConsentAction' })
  action!: ConsentAction;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}
