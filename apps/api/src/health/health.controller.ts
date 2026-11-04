import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';

import { HealthReportDto } from './health-report.dto.js';
import { HealthService } from './health.service.js';
import type { HealthReport } from './health.service.js';

/**
 * `GET /api/health`, outside `/api/v1` (decision 0005, section 1). The only route of the
 * foundation; no authentication (the first `@Public()` route once the auth guard arrives).
 * 200 when the database answers, 503 with the failing entry otherwise.
 */
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
