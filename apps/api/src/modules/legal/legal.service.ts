import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, LessThanOrEqual } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { ApiError } from '../../common/errors/api-error.js';
import { Clock } from '../../common/time/clock.js';
import {
  CONSENT_DOCUMENT_TYPES,
  ConsentDocument,
} from '../users/entities/consent-document.entity.js';
import type { ConsentDocumentType } from '../users/entities/consent-document.entity.js';
import { UserConsent } from '../users/entities/user-consent.entity.js';
import type { ConsentAction, ConsentClient } from '../users/entities/user-consent.entity.js';

/** The locale whose documents registration accepts (api-outline, Conventions "Locale": `vi`). */
export const DEFAULT_CONSENT_LOCALE = 'vi';

/**
 * `Cache-Control` of `GET /legal/documents/current`: short, so a newly published version reaches
 * the apps within minutes without a deploy (api-divergences D-120).
 */
export const LEGAL_CACHE_CONTROL = 'public, max-age=300';

/**
 * Version prefix of the placeholder documents that the seed publishes until the owner and counsel
 * supply the real text (migration-plan open item 3; A4-T5). Their first line says, in Vietnamese,
 * that the text is a placeholder and not legal text.
 */
export const PLACEHOLDER_VERSION_PREFIX = 'placeholder-';

/** True for a placeholder document (see `PLACEHOLDER_VERSION_PREFIX`); `verify reference` uses it. */
export function isPlaceholderDocument(version: string): boolean {
  return version.startsWith(PLACEHOLDER_VERSION_PREFIX);
}

export interface ConsentEvent {
  readonly userId: string;
  readonly documentIds: readonly string[];
  readonly action: ConsentAction;
  readonly client: ConsentClient;
  /** Already bounded by the caller (api-divergences D-047); `null` when unknown. */
  readonly appVersion: string | null;
}

/** One document of `GET /legal/documents/current`. */
export interface ConsentDocumentView {
  readonly id: string;
  readonly type: ConsentDocumentType;
  readonly version: string;
  readonly locale: string;
  readonly publishedAt: Date;
  readonly contentSha256: string;
  readonly content: string;
}

/** `GET /legal/documents/current`: one document per type, in `CONSENT_DOCUMENT_TYPES` order. */
export interface CurrentDocumentsView {
  readonly documents: readonly ConsentDocumentView[];
}

function isNewer(candidate: ConsentDocument, kept: ConsentDocument): boolean {
  const difference = candidate.publishedAt.getTime() - kept.publishedAt.getTime();
  // Ties are broken by the time-ordered id (uuidv7), compared without regard to case.
  return difference !== 0 ? difference > 0 : candidate.id.toLowerCase() > kept.id.toLowerCase();
}

/**
 * The current document of each type among `documents`: the latest `published_at`, never a
 * comparison of version strings. A type with no document is absent. In `CONSENT_DOCUMENT_TYPES`
 * order.
 */
export function latestPerType(documents: readonly ConsentDocument[]): ConsentDocument[] {
  const latest = new Map<ConsentDocumentType, ConsentDocument>();
  for (const document of documents) {
    const kept = latest.get(document.type);
    if (kept === undefined || isNewer(document, kept)) {
      latest.set(document.type, document);
    }
  }
  return CONSENT_DOCUMENT_TYPES.flatMap((type) => {
    const document = latest.get(type);
    return document === undefined ? [] : [document];
  });
}

/**
 * The view of the current documents. A current document without text (`content` null, published
 * before migration 0012) is skipped, not replaced by an older one: registration accepts only the
 * current ids, so serving an older id would offer one it refuses. `NOT_FOUND` unless every type has
 * a servable document (api-divergences D-120).
 */
export function toCurrentDocumentsView(current: readonly ConsentDocument[]): CurrentDocumentsView {
  const documents: ConsentDocumentView[] = [];
  for (const type of CONSENT_DOCUMENT_TYPES) {
    const document = current.find((candidate) => candidate.type === type);
    if (document === undefined || document.content === null) {
      throw new ApiError('NOT_FOUND', { detail: 'No current legal document.' });
    }
    documents.push({
      id: document.id,
      type: document.type,
      version: document.version,
      locale: document.locale,
      publishedAt: document.publishedAt,
      contentSha256: document.contentSha256,
      content: document.content,
    });
  }
  return { documents };
}

/**
 * Strong `ETag` of a `CurrentDocumentsView`, from the stored ids and hashes: a published row never
 * changes, so (id, `content_sha256`) of each document determines the whole body.
 */
export function currentDocumentsEtag(view: CurrentDocumentsView): string {
  const source = view.documents
    .map((document) => `${document.id}:${document.contentSha256}`)
    .join('\n');
  return `"${createHash('sha256').update(source).digest('base64url')}"`;
}

/**
 * Legal documents and consent events (data-model, "Privacy, governance and system":
 * `consent_documents`, `user_consents`). `consent_documents` is read and inserted only (no admin
 * endpoint publishes: the seed does, A4-T5); `user_consents` is insert-only for `kd_app`.
 */
@Injectable()
export class LegalService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * The current document of each type for `locale`: among the documents whose `published_at` is not
   * in the future, the latest one (`latestPerType`). A type with no published document is absent.
   * The one lookup of `POST /auth/register`, the social sign-up and `GET /legal/documents/current`,
   * so the ids the app is shown are exactly the ids registration accepts.
   */
  async currentDocuments(
    locale: string = DEFAULT_CONSENT_LOCALE,
    manager?: EntityManager,
  ): Promise<ConsentDocument[]> {
    const published = await (manager ?? this.dataSource.manager).find(ConsentDocument, {
      where: { locale, publishedAt: LessThanOrEqual(this.clock.now()) },
    });
    return latestPerType(published);
  }

  /**
   * `GET /legal/documents/current`: the current Terms of Service and Privacy Policy for `locale`,
   * or for `vi` when `locale` has no published document. `NOT_FOUND` when a type has none with text.
   */
  async getCurrent(locale: string = DEFAULT_CONSENT_LOCALE): Promise<CurrentDocumentsView> {
    let current = await this.currentDocuments(locale);
    if (current.length === 0 && locale !== DEFAULT_CONSENT_LOCALE) {
      current = await this.currentDocuments(DEFAULT_CONSENT_LOCALE);
    }
    return toCurrentDocumentsView(current);
  }

  /** One `user_consents` row per document, all at the same instant. Joins the caller's transaction. */
  async recordConsents(event: ConsentEvent, manager?: EntityManager): Promise<void> {
    if (event.documentIds.length === 0) {
      return;
    }
    const occurredAt = this.clock.now();
    await (manager ?? this.dataSource.manager)
      .createQueryBuilder()
      .insert()
      .into(UserConsent)
      .values(
        event.documentIds.map((documentId) => ({
          userId: event.userId,
          documentId,
          action: event.action,
          occurredAt,
          client: event.client,
          appVersion: event.appVersion,
        })),
      )
      .updateEntity(false)
      .execute();
  }
}
