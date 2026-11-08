import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { Public } from '../../common/auth/public.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { PublicConfigDto } from './dto/public-config.dto.js';
import { PublicConfigService } from './public-config.service.js';
import type { PublicConfigView } from './public-config.service.js';

/**
 * `GET /meta/config` (api-outline Public table; A4-T3). `@Public()`, the lenient `default`
 * throttler (600 per minute per client), and exempt from the maintenance and minimum-version gates
 * (`common/gates/app-gates.guard.ts`): it is what the maintenance and forced-update screens read.
 */
@Public()
@Controller('meta')
export class MetaController {
  constructor(@Inject(PublicConfigService) private readonly config: PublicConfigService) {}

  /** Brand, minimum versions, maintenance, flags, ordering limits, transfer availability, rates. */
  @Get('config')
  @ApiOkResponse({ type: PublicConfigDto })
  @ApiProblemResponses('RATE_LIMITED')
  read(): Promise<PublicConfigView> {
    return this.config.read();
  }
}
