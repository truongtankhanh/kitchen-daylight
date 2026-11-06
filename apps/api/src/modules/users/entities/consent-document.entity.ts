import { Column, Entity, PrimaryColumn } from 'typeorm';

/** `public.consent_document_type` (migration `0008_auth_tokens_identities_mfa_consent.sql`). */
export const CONSENT_DOCUMENT_TYPES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'] as const;
export type ConsentDocumentType = (typeof CONSENT_DOCUMENT_TYPES)[number];

/**
 * One row of `public.consent_documents` (migration `0008_auth_tokens_identities_mfa_consent.sql`):
 * one published version of a legal document per locale, unique on (`type`, `version`, `locale`).
 * Immutable: `kd_app` has `SELECT, INSERT` only. The text itself has no column yet (A4-T4). Columns
 * state `type` and `name` explicitly (decision 0007 sections 2 and 8).
 */
@Entity({ name: 'consent_documents', schema: 'public' })
export class ConsentDocument {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id!: string;

  @Column({
    type: 'enum',
    name: 'type',
    enum: CONSENT_DOCUMENT_TYPES,
    enumName: 'consent_document_type',
  })
  type!: ConsentDocumentType;

  @Column({ type: 'text', name: 'version' })
  version!: string;

  @Column({ type: 'text', name: 'locale' })
  locale!: string;

  /** Lower-case hex SHA-256 of the published text, 64 characters. */
  @Column({ type: 'text', name: 'content_sha256' })
  contentSha256!: string;

  @Column({ type: 'timestamptz', name: 'published_at' })
  publishedAt!: Date;
}
