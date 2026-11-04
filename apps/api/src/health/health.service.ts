import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export const DATABASE_CHECK_TIMEOUT_MS = 1_000;

export type CheckStatus = 'up' | 'down';

/** The body of `GET /api/health`: statuses only, never an error, host or credential. */
export interface HealthReport {
  readonly status: 'ok' | 'error';
  readonly checks: { readonly database: CheckStatus };
}

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(): Promise<HealthReport> {
    const database = await this.checkDatabase();
    return { status: database === 'up' ? 'ok' : 'error', checks: { database } };
  }

  private async checkDatabase(): Promise<CheckStatus> {
    if (!this.dataSource.isInitialized) {
      return 'down';
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), DATABASE_CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
