import { Inject, Injectable } from '@nestjs/common';

import type { MaintenanceSetting } from '../../modules/settings/schema/maintenance.schema.js';
import type { MinAppVersionSetting } from '../../modules/settings/schema/min-app-version.schema.js';
import { SettingsService } from '../../modules/settings/settings.service.js';
import { Clock } from '../time/clock.js';

/** How long a read of the two gate keys is reused (A4-T3). */
export const GATE_SNAPSHOT_TTL_MS = 5_000;

/** What the request gates need: the two settings keys, as values. */
export interface GateState {
  readonly maintenance: MaintenanceSetting;
  readonly minAppVersion: MinAppVersionSetting;
}

interface CachedState {
  readonly state: GateState;
  readonly readAt: number;
}

/**
 * `maintenance` and `minAppVersion` for the request gates, kept in memory so that a request does
 * not query the database while the snapshot is fresh (`GATE_SNAPSHOT_TTL_MS`, from the injected
 * `Clock`). A stale or empty snapshot is refreshed on demand with one primary-key read per key;
 * concurrent requests share one refresh. A settings save in this process calls `invalidate()`
 * after its commit, so the change applies at once here.
 *
 * One API instance (ADR-0004): the in-process invalidation reaches every request. With more than
 * one instance, another instance sees a change only when its snapshot expires (at most 5 s);
 * shorten the TTL or invalidate from the `config.changed` relay (A10) when that happens.
 */
@Injectable()
export class GateSnapshot {
  private cached: CachedState | undefined;
  private pending: Promise<GateState> | undefined;
  /** Bumped by `invalidate()`, so a refresh started before it does not repopulate the cache. */
  private generation = 0;

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** The fresh snapshot, or a new read when it is older than the TTL or invalidated. */
  async current(): Promise<GateState> {
    const now = this.clock.now().getTime();
    if (this.cached !== undefined && now - this.cached.readAt < GATE_SNAPSHOT_TTL_MS) {
      return this.cached.state;
    }
    this.pending ??= this.refresh(this.generation);
    return this.pending;
  }

  /** Drops the snapshot; the next request reads the keys again. */
  invalidate(): void {
    this.generation += 1;
    this.cached = undefined;
    this.pending = undefined;
  }

  private async refresh(generation: number): Promise<GateState> {
    try {
      const state: GateState = {
        maintenance: await this.settings.getValue('maintenance'),
        minAppVersion: await this.settings.getValue('minAppVersion'),
      };
      if (generation === this.generation) {
        this.cached = { state, readAt: this.clock.now().getTime() };
      }
      return state;
    } finally {
      if (generation === this.generation) {
        this.pending = undefined;
      }
    }
  }
}
