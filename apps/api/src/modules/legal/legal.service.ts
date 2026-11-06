import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { Clock } from '../../common/time/clock.js';
import { ConsentDocument } from '../users/entities/consent-document.entity.js';
import { UserConsent } from '../users/entities/user-consent.entity.js';
import type { ConsentAction, ConsentClient } from '../users/entities/user-consent.entity.js';

/** The locale whose documents registration accepts (api-outline, Conventions "Locale": `vi`). */
export const DEFAULT_CONSENT_LOCALE = 'vi';

export interface ConsentEvent {
  readonly userId: string;
  readonly documentIds: readonly string[];
  readonly action: ConsentAction;
  readonly client: ConsentClient;
  /** Already bounded by the caller (api-divergences D-047); `null` when unknown. */
  readonly appVersion: string | null;
}

/**
 * Legal documents and consent events (data-model, "Privacy, governance and system":
 * `consent_documents`, `user_consents`). No controller: the consent endpoint is A4-T4.
 * `consent_documents` and `user_consents` are insert-only for `kd_app`.
 */
@Injectable()
export class LegalService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * The current document of each type for `locale`: the one with the latest `published_at` that
   * is not in the future (ties broken by the time-ordered id). A type with no published document is
   * absent from the result.
   */
  async currentDocuments(
    locale: string = DEFAULT_CONSENT_LOCALE,
    manager?: EntityManager,
  ): Promise<ConsentDocument[]> {
    return (manager ?? this.dataSource.manager)
      .createQueryBuilder(ConsentDocument, 'document')
      .distinctOn(['document.type'])
      .where('document.locale = :locale', { locale })
      .andWhere('document.publishedAt <= :now', { now: this.clock.now() })
      .orderBy('document.type', 'ASC')
      .addOrderBy('document.publishedAt', 'DESC')
      .addOrderBy('document.id', 'DESC')
      .getMany();
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
