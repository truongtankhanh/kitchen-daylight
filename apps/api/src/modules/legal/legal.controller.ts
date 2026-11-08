import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiOkResponse, ApiResponse } from '@nestjs/swagger';

import { Public } from '../../common/auth/public.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { CurrentDocumentsDto, CurrentDocumentsQueryDto } from './dto/consent-document.dto.js';
import {
  currentDocumentsEtag,
  DEFAULT_CONSENT_LOCALE,
  LEGAL_CACHE_CONTROL,
  LegalService,
} from './legal.service.js';
import type { CurrentDocumentsView } from './legal.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata, which the test transformer may not emit (decision 0007 section 2). The same small pipe
 * as `ValidatedAs` in `geo.controller.ts`; a shared copy belongs in `common/errors` once a task may
 * change that file.
 */
class ValidatedAs implements PipeTransform {
  private readonly pipe = createValidationPipe();

  constructor(private readonly type: Type<unknown>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return this.pipe.transform(value, { ...metadata, metatype: this.type }) as Promise<unknown>;
  }
}

/** The one method of the Express response used here; `@types/express` is not a dependency. */
interface ResponseHeaders {
  setHeader(name: string, value: string): unknown;
}

const CACHE_HEADERS = {
  'Cache-Control': { description: LEGAL_CACHE_CONTROL, schema: { type: 'string' } },
  ETag: {
    description: 'Strong tag from the document ids and hashes; send it back as `If-None-Match`.',
    schema: { type: 'string' },
  },
} as const;

/**
 * Legal documents (api-outline, Public table; mobile G104). `@Public()`, so a guest reads them before
 * signing in, on the lenient `default` throttler. A success sends `Cache-Control` and a strong
 * `ETag` once the body exists (an error answer is never marked cacheable); Express answers `304`
 * with no body when `If-None-Match` matches. No admin endpoint publishes a document: the seed does
 * (A4-T5), and a new version is a new row.
 */
@Public()
@Controller('legal')
export class LegalController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  /** The current Terms of Service and Privacy Policy, with their text and the ids to accept. */
  @Get('documents/current')
  @ApiOkResponse({ type: CurrentDocumentsDto, headers: CACHE_HEADERS })
  @ApiResponse({ status: 304, description: 'Not modified (`If-None-Match` matched).' })
  @ApiProblemResponses('VALIDATION_FAILED', 'NOT_FOUND', 'RATE_LIMITED')
  async current(
    @Query(new ValidatedAs(CurrentDocumentsQueryDto)) query: CurrentDocumentsQueryDto,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ): Promise<CurrentDocumentsView> {
    const body = await this.legal.getCurrent(query.locale ?? DEFAULT_CONSENT_LOCALE);
    response.setHeader('Cache-Control', LEGAL_CACHE_CONTROL);
    response.setHeader('ETag', currentDocumentsEtag(body));
    return body;
  }
}
