import { applyDecorators } from '@nestjs/common';
import { ERROR_STATUS } from '@kd/contracts';
import type { ErrorCode } from '@kd/contracts';
import { ApiResponse, getSchemaPath } from '@nestjs/swagger';

/** The schema name of `ProblemDetailsDto`, listed in the document through `extraModels`. */
const PROBLEM_SCHEMA = getSchemaPath('ProblemDetails');

/**
 * Declares the error responses of a route in one line (decision 0007 section 13, contract rule):
 * `@ApiProblemResponses('NOT_FOUND', 'STALE_VERSION')`. Codes are grouped by their status; each
 * response is `application/problem+json` with the `ProblemDetails` schema and lists its codes.
 */
export function ApiProblemResponses(
  ...codes: [ErrorCode, ...ErrorCode[]]
): MethodDecorator & ClassDecorator {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of new Set(codes)) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }

  const responses = [...byStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, list]) =>
      ApiResponse({
        status,
        description: list.join(', '),
        content: { 'application/problem+json': { schema: { $ref: PROBLEM_SCHEMA } } },
      }),
    );
  return applyDecorators(...responses);
}
