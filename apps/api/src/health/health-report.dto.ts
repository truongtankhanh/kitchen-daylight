import { ApiSchema } from '@nestjs/swagger';

import type { CheckStatus, HealthReport } from './health.service.js';

@ApiSchema({ name: 'HealthChecks' })
export class HealthChecksDto {
  database!: CheckStatus;
}

/** OpenAPI schema of the `GET /api/health` body, for 200 and 503 alike. */
@ApiSchema({ name: 'HealthReport' })
export class HealthReportDto implements HealthReport {
  status!: 'ok' | 'error';
  checks!: HealthChecksDto;
}
