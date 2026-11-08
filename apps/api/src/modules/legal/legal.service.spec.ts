import { createHash } from 'node:crypto';

import type { DataSource, FindOperator } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../common/errors/api-error.js';
import { FixedClock } from '../../common/time/testing.js';
import { ConsentDocument } from '../users/entities/consent-document.entity.js';
import type { ConsentDocumentType } from '../users/entities/consent-document.entity.js';
import {
  currentDocumentsEtag,
  DEFAULT_CONSENT_LOCALE,
  isPlaceholderDocument,
  latestPerType,
  LegalService,
  toCurrentDocumentsView,
} from './legal.service.js';

// Fictional documents; the text is fixture text, not legal text.

const NOW = '2026-11-09T03:00:00.000Z';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function document(
  id: string,
  type: ConsentDocumentType,
  publishedAt: string,
  options: { version?: string; locale?: string; content?: string | null } = {},
): ConsentDocument {
  const content = options.content === undefined ? `Văn bản mẫu ${id}` : options.content;
  return Object.assign(new ConsentDocument(), {
    id,
    type,
    version: options.version ?? id,
    locale: options.locale ?? 'vi',
    contentSha256: sha256(content ?? id),
    content,
    publishedAt: new Date(publishedAt),
  });
}

interface FindOptions {
  where: { locale: string; publishedAt: FindOperator<Date> };
}

/**
 * A `DataSource` whose manager filters `rows` in memory the way the `find` options say: the locale,
 * and `publishedAt <= value` of the `LessThanOrEqual` operator.
 */
function fakeDataSource(rows: readonly ConsentDocument[]) {
  const find = vi.fn(async (_entity: unknown, options: FindOptions) => {
    const limit = options.where.publishedAt.value as Date;
    return rows.filter(
      (row) => row.locale === options.where.locale && row.publishedAt.getTime() <= limit.getTime(),
    );
  });
  return { dataSource: { manager: { find } } as unknown as DataSource, find };
}

/** The `code` of the `ApiError` that `work` throws; fails the spec when it throws nothing else. */
function thrownCode(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
  throw new Error('expected an ApiError');
}

function serviceWith(rows: readonly ConsentDocument[]) {
  const fake = fakeDataSource(rows);
  return { service: new LegalService(fake.dataSource, new FixedClock(NOW)), find: fake.find };
}

describe('latestPerType', () => {
  it('keeps the latest published_at of each type, whatever the version strings say', () => {
    const rows = [
      document('a1', 'TERMS_OF_SERVICE', '2026-10-01T00:00:00Z', { version: '10' }),
      document('a2', 'TERMS_OF_SERVICE', '2026-11-01T00:00:00Z', { version: '9' }),
      document('b1', 'PRIVACY_POLICY', '2026-09-01T00:00:00Z', { version: '2' }),
      document('b2', 'PRIVACY_POLICY', '2026-08-01T00:00:00Z', { version: '3' }),
    ];

    expect(latestPerType(rows).map((row) => row.id)).toEqual(['a2', 'b1']);
  });

  it('breaks a tie of published_at by the time-ordered id, without regard to case', () => {
    const earlier = document('01930000-0000-7000-8000-00000000000a', 'TERMS_OF_SERVICE', NOW);
    const later = document('01930000-0000-7000-8000-00000000000B', 'TERMS_OF_SERVICE', NOW);

    expect(latestPerType([later, earlier])).toEqual([later]);
    expect(latestPerType([earlier, later])).toEqual([later]);
  });

  it('answers Terms first, then Privacy, and leaves out a type without a document', () => {
    const privacy = document('p', 'PRIVACY_POLICY', '2026-01-01T00:00:00Z');
    const terms = document('t', 'TERMS_OF_SERVICE', '2026-01-01T00:00:00Z');

    expect(latestPerType([privacy, terms])).toEqual([terms, privacy]);
    expect(latestPerType([privacy])).toEqual([privacy]);
    expect(latestPerType([])).toEqual([]);
  });
});

describe('toCurrentDocumentsView', () => {
  it('maps each current document to the public shape', () => {
    const terms = document('t', 'TERMS_OF_SERVICE', '2026-01-01T00:00:00Z');
    const privacy = document('p', 'PRIVACY_POLICY', '2026-01-02T00:00:00Z');

    expect(toCurrentDocumentsView([terms, privacy])).toEqual({
      documents: [
        {
          id: 't',
          type: 'TERMS_OF_SERVICE',
          version: 't',
          locale: 'vi',
          publishedAt: new Date('2026-01-01T00:00:00Z'),
          contentSha256: terms.contentSha256,
          content: 'Văn bản mẫu t',
        },
        {
          id: 'p',
          type: 'PRIVACY_POLICY',
          version: 'p',
          locale: 'vi',
          publishedAt: new Date('2026-01-02T00:00:00Z'),
          contentSha256: privacy.contentSha256,
          content: 'Văn bản mẫu p',
        },
      ],
    });
  });

  it('skips a current document without text, so its type is missing: NOT_FOUND', () => {
    const terms = document('t', 'TERMS_OF_SERVICE', '2026-01-01T00:00:00Z', { content: null });
    const privacy = document('p', 'PRIVACY_POLICY', '2026-01-01T00:00:00Z');

    expect(thrownCode(() => toCurrentDocumentsView([terms, privacy]))).toBe('NOT_FOUND');
  });

  it('is NOT_FOUND when a type has no document', () => {
    const terms = document('t', 'TERMS_OF_SERVICE', '2026-01-01T00:00:00Z');

    expect(thrownCode(() => toCurrentDocumentsView([terms]))).toBe('NOT_FOUND');
    expect(thrownCode(() => toCurrentDocumentsView([]))).toBe('NOT_FOUND');
  });
});

describe('currentDocumentsEtag', () => {
  const terms = document('t', 'TERMS_OF_SERVICE', '2026-01-01T00:00:00Z');
  const privacy = document('p', 'PRIVACY_POLICY', '2026-01-01T00:00:00Z');

  it('is a quoted base64url SHA-256, stable for the same documents', () => {
    const view = toCurrentDocumentsView([terms, privacy]);

    expect(currentDocumentsEtag(view)).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(currentDocumentsEtag(view)).toBe(
      currentDocumentsEtag(toCurrentDocumentsView([privacy, terms])),
    );
  });

  it('changes when a new version replaces a document', () => {
    const newer = document('t2', 'TERMS_OF_SERVICE', '2026-02-01T00:00:00Z');

    expect(currentDocumentsEtag(toCurrentDocumentsView([newer, privacy]))).not.toBe(
      currentDocumentsEtag(toCurrentDocumentsView([terms, privacy])),
    );
  });
});

describe('isPlaceholderDocument', () => {
  it('is true only for a version starting with placeholder-', () => {
    expect(isPlaceholderDocument('placeholder-2026-11')).toBe(true);
    expect(isPlaceholderDocument('placeholder-')).toBe(true);
    expect(isPlaceholderDocument('1.0')).toBe(false);
    expect(isPlaceholderDocument('Placeholder-1')).toBe(false);
    expect(isPlaceholderDocument('v1-placeholder-')).toBe(false);
    expect(isPlaceholderDocument('')).toBe(false);
  });
});

describe('LegalService', () => {
  const ROWS = [
    document('vi-terms-1', 'TERMS_OF_SERVICE', '2026-01-01T00:00:00Z'),
    document('vi-terms-2', 'TERMS_OF_SERVICE', '2026-10-01T00:00:00Z'),
    document('vi-privacy-1', 'PRIVACY_POLICY', '2026-10-01T00:00:00Z'),
    // Published in the future: not current yet.
    document('vi-privacy-2', 'PRIVACY_POLICY', '2027-01-01T00:00:00Z'),
    document('en-terms-1', 'TERMS_OF_SERVICE', '2026-10-15T00:00:00Z', { locale: 'en' }),
    document('en-privacy-1', 'PRIVACY_POLICY', '2026-10-15T00:00:00Z', { locale: 'en' }),
  ];

  describe('currentDocuments', () => {
    it('reads the locale up to now and keeps the latest of each type', async () => {
      const { service, find } = serviceWith(ROWS);

      const current = await service.currentDocuments();

      expect(current.map((row) => row.id)).toEqual(['vi-terms-2', 'vi-privacy-1']);
      expect(find).toHaveBeenCalledWith(ConsentDocument, {
        where: { locale: DEFAULT_CONSENT_LOCALE, publishedAt: expect.anything() as unknown },
      });
    });

    it('reads through the caller manager when one is given', async () => {
      const { service, find } = serviceWith([]);
      const other = fakeDataSource(ROWS);

      const current = await service.currentDocuments('vi', other.dataSource.manager);

      expect(current.map((row) => row.id)).toEqual(['vi-terms-2', 'vi-privacy-1']);
      expect(find).not.toHaveBeenCalled();
    });
  });

  describe('getCurrent', () => {
    it('serves exactly the ids of the lookup that registration uses', async () => {
      const { service } = serviceWith(ROWS);

      const view = await service.getCurrent();
      const registration = await service.currentDocuments(DEFAULT_CONSENT_LOCALE);

      expect(view.documents.map((row) => row.id)).toEqual(registration.map((row) => row.id));
    });

    it('serves the requested locale when it has documents', async () => {
      const { service } = serviceWith(ROWS);

      const view = await service.getCurrent('en');

      expect(view.documents.map((row) => [row.id, row.locale])).toEqual([
        ['en-terms-1', 'en'],
        ['en-privacy-1', 'en'],
      ]);
    });

    it('falls back to vi when the locale has no document', async () => {
      const { service, find } = serviceWith(ROWS);

      const view = await service.getCurrent('fr');

      expect(view.documents.map((row) => [row.id, row.locale])).toEqual([
        ['vi-terms-2', 'vi'],
        ['vi-privacy-1', 'vi'],
      ]);
      expect(find).toHaveBeenCalledTimes(2);
    });

    it('does not offer an older version when the newest has no text: NOT_FOUND', async () => {
      const { service } = serviceWith([
        ...ROWS,
        document('vi-terms-3', 'TERMS_OF_SERVICE', '2026-11-01T00:00:00Z', { content: null }),
      ]);

      await expect(service.getCurrent()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('is NOT_FOUND when nothing is published', async () => {
      const { service } = serviceWith([]);

      await expect(service.getCurrent()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
