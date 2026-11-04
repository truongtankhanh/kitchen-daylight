import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthController } from './health.controller.js';
import { DATABASE_CHECK_TIMEOUT_MS, HealthService } from './health.service.js';

function fakeDataSource(query: () => Promise<unknown>, isInitialized = true): DataSource {
  return { isInitialized, query: vi.fn(query) } as unknown as DataSource;
}

function controllerWith(dataSource: DataSource): HealthController {
  return new HealthController(new HealthService(dataSource));
}

const UP = { status: 'ok', checks: { database: 'up' } };
const DOWN = { status: 'error', checks: { database: 'down' } };

describe('GET /api/health', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 200 with the database up', async () => {
    const dataSource = fakeDataSource(async () => [{ '?column?': 1 }]);

    await expect(controllerWith(dataSource).check()).resolves.toEqual(UP);
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 with the failing entry when the query fails', async () => {
    const dataSource = fakeDataSource(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 for user kd_app');
    });

    const error = await controllerWith(dataSource)
      .check()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual(DOWN);
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toMatch(
      /10\.0\.0\.5|kd_app|ECONNREFUSED/,
    );
  });

  it('returns 503 when the query exceeds the timeout', async () => {
    vi.useFakeTimers();
    const dataSource = fakeDataSource(() => new Promise(() => undefined));

    const pending = controllerWith(dataSource)
      .check()
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(DATABASE_CHECK_TIMEOUT_MS);

    expect(((await pending) as ServiceUnavailableException).getResponse()).toEqual(DOWN);
  });

  it('returns 503 without querying when the data source is not initialized', async () => {
    const dataSource = fakeDataSource(async () => [], false);

    const error = await controllerWith(dataSource)
      .check()
      .catch((caught: unknown) => caught);

    expect((error as ServiceUnavailableException).getResponse()).toEqual(DOWN);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
