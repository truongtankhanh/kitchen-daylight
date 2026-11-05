/**
 * Rounds a latitude or longitude to 2 decimals (about 1 km) before it reaches a log line
 * (decision 0005, section 11; data-model "Data minimisation"). Application code that logs a
 * coordinate passes it through this function. Never throws: a non-finite input gives `NaN`,
 * which pino writes as `null`.
 */
export function roundCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  const rounded = Math.round(value * 100) / 100;
  // `Math.round(-0.001 * 100)` is `-0`; a log line shows `0`.
  return Object.is(rounded, -0) ? 0 : rounded;
}
