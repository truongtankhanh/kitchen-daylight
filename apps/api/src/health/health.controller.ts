import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../common/auth/public.decorator.js';
import { HealthReportDto } from './health-report.dto.js';
import { HealthService } from './health.service.js';
import type { HealthReport } from './health.service.js';

/**
 * `GET /api/health`, outside `/api/v1` (decision 0005, section 1). `@Public()`: no token, and no
 * security requirement in the OpenAPI document. Never throttled, because the Docker health check
 * calls it every 5 s from one address. 200 when the database answers, 503 with the failing entry
 * otherwise.
 */
@Public()
@SkipThrottle({ default: true, auth: true })
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: HealthReportDto })
  @ApiServiceUnavailableResponse({ type: HealthReportDto })
  async check(): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
