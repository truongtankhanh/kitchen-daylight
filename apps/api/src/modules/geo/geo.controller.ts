import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { ApiOkResponse, ApiResponse } from '@nestjs/swagger';

import { Public } from '../../common/auth/public.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { createValidationPipe } from '../../common/errors/validation.pipe.js';
import { ProvinceDto, WardDto } from './dto/admin-unit.dto.js';
import { ListWardsQueryDto } from './dto/list-wards-query.dto.js';
import { GEO_CACHE_CONTROL, GeoService, strongEtag } from './geo.service.js';

/**
 * The global validation pipe with the DTO class named here instead of read from emitted decorator
 * metadata, which the test transformer may not emit (decision 0007 section 2). The same small pipe
 * as `BodyOf` in `auth.controller.ts` and `auth-codes.controller.ts`; a shared copy belongs in
 * `common/errors` once a task may change that file.
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
  'Cache-Control': { description: GEO_CACHE_CONTROL, schema: { type: 'string' } },
  ETag: {
    description: 'Strong tag of the body; send it back as `If-None-Match`.',
    schema: { type: 'string' },
  },
} as const;

/**
 * Sets `Cache-Control` and the `ETag` once the body exists, so an error answer (`400`, `404`, `429`)
 * is never marked cacheable: `@Header()` would also put `Cache-Control` on those.
 */
function setCacheHeaders(response: ResponseHeaders, body: unknown): void {
  response.setHeader('Cache-Control', GEO_CACHE_CONTROL);
  response.setHeader('ETag', strongEtag(body));
}

/**
 * Administrative units for addresses (api-outline, Public table; data-model "Geography"). Both
 * routes are `@Public()` and take the lenient `default` throttler. A success sends `Cache-Control` and
 * a strong `ETag`; Express answers `304` with no body when `If-None-Match` matches (it keeps an `ETag`
 * already set and checks freshness before sending). Shapes in api-divergences D-055.
 * `GET /admin/wards` (staff search) is `AdminWardsController` (A5-T5).
 */
@Public()
@Controller()
export class GeoController {
  constructor(@Inject(GeoService) private readonly geo: GeoService) {}

  @Get('provinces')
  @ApiOkResponse({ type: ProvinceDto, isArray: true, headers: CACHE_HEADERS })
  @ApiResponse({ status: 304, description: 'Not modified (`If-None-Match` matched).' })
  @ApiProblemResponses('RATE_LIMITED')
  async listProvinces(
    @Res({ passthrough: true }) response: ResponseHeaders,
  ): Promise<ProvinceDto[]> {
    const body = await this.geo.listProvinces();
    setCacheHeaders(response, body);
    return body;
  }

  @Get('wards')
  @ApiOkResponse({ type: WardDto, isArray: true, headers: CACHE_HEADERS })
  @ApiResponse({ status: 304, description: 'Not modified (`If-None-Match` matched).' })
  @ApiProblemResponses('VALIDATION_FAILED', 'NOT_FOUND', 'RATE_LIMITED')
  async listWards(
    @Query(new ValidatedAs(ListWardsQueryDto)) query: ListWardsQueryDto,
    @Res({ passthrough: true }) response: ResponseHeaders,
  ): Promise<WardDto[]> {
    const body = await this.geo.listWards(query.provinceCode);
    setCacheHeaders(response, body);
    return body;
  }
}
