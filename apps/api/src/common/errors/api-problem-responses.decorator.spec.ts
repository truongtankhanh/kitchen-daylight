import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { ApiProblemResponses } from './api-problem-responses.decorator.js';

// `@nestjs/swagger` stores the responses of a route under this metadata key, keyed by status.
const API_RESPONSE = 'swagger/apiResponse';

type Responses = Record<string, { description?: string; content?: unknown }>;

class Probe {
  @ApiProblemResponses('NOT_FOUND', 'STALE_VERSION', 'IN_USE', 'NOT_FOUND')
  handler(): void {
    return undefined;
  }
}

/** Swagger keeps method metadata on the method function itself (`descriptor.value`). */
function responsesOf(target: object, method: string): Responses {
  const handler: unknown = Object.getOwnPropertyDescriptor(target, method)?.value;
  return Reflect.getMetadata(API_RESPONSE, handler as object) as Responses;
}

describe('ApiProblemResponses', () => {
  const responses = responsesOf(Probe.prototype, 'handler');

  it('declares one response per status of the given codes', () => {
    expect(Object.keys(responses).sort()).toEqual(['404', '409']);
  });

  it('lists the codes of each status once, in the given order', () => {
    expect(responses['404']?.description).toBe('NOT_FOUND');
    expect(responses['409']?.description).toBe('STALE_VERSION, IN_USE');
  });

  it('uses application/problem+json with the ProblemDetails schema', () => {
    for (const status of ['404', '409']) {
      expect(responses[status]?.content).toEqual({
        'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
      });
    }
  });
});
