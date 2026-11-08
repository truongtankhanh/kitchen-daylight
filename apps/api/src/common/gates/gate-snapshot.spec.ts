import { describe, expect, it, vi } from 'vitest';

import { SETTING_DEFAULTS } from '../../modules/settings/settings-defaults.js';
import type { SettingsService } from '../../modules/settings/settings.service.js';
import { FixedClock } from '../time/testing.js';
import { GATE_SNAPSHOT_TTL_MS, GateSnapshot } from './gate-snapshot.js';

const NOW = '2026-11-08T03:00:00.000Z';

function snapshotWith(maintenanceEnabled: () => boolean) {
  const clock = new FixedClock(NOW);
  const getValue = vi.fn((key: string) =>
    Promise.resolve(
      key === 'maintenance'
        ? { ...SETTING_DEFAULTS.maintenance, enabled: maintenanceEnabled() }
        : SETTING_DEFAULTS.minAppVersion,
    ),
  );
  const snapshot = new GateSnapshot({ getValue } as unknown as SettingsService, clock);
  return { snapshot, clock, getValue };
}

describe('GateSnapshot', () => {
  it('reads each key once, then serves from memory while fresh', async () => {
    const { snapshot, clock, getValue } = snapshotWith(() => false);

    await snapshot.current();
    clock.advance(GATE_SNAPSHOT_TTL_MS - 1);
    await snapshot.current();

    expect(getValue.mock.calls.map(([key]) => key)).toEqual(['maintenance', 'minAppVersion']);
  });

  it('reads again once the TTL has passed', async () => {
    const { snapshot, clock, getValue } = snapshotWith(() => false);

    await snapshot.current();
    clock.advance(GATE_SNAPSHOT_TTL_MS);
    await snapshot.current();

    expect(getValue).toHaveBeenCalledTimes(4);
  });

  it('reads again at once after invalidate()', async () => {
    let enabled = false;
    const { snapshot } = snapshotWith(() => enabled);

    expect((await snapshot.current()).maintenance.enabled).toBe(false);
    enabled = true;
    expect((await snapshot.current()).maintenance.enabled).toBe(false);
    snapshot.invalidate();
    expect((await snapshot.current()).maintenance.enabled).toBe(true);
  });

  it('shares one read between concurrent requests', async () => {
    const { snapshot, getValue } = snapshotWith(() => false);

    await Promise.all([snapshot.current(), snapshot.current(), snapshot.current()]);

    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it('does not cache a read that an invalidate() overtook', async () => {
    let enabled = false;
    const { snapshot, getValue } = snapshotWith(() => enabled);

    const inFlight = snapshot.current();
    snapshot.invalidate();
    enabled = true;
    await inFlight;

    expect((await snapshot.current()).maintenance.enabled).toBe(true);
    expect(getValue).toHaveBeenCalledTimes(4);
  });
});
