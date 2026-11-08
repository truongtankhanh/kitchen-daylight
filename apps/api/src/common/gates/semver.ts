// `x.y.z` app versions (brief L12): the format of `minAppVersion` (A4-T1) and of the
// `X-App-Version` header. Three non-negative integers without leading zeros, at most six digits
// each; no pre-release or build suffix.

export interface AppVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Longest header value looked at; a longer one is malformed without running the pattern. */
export const APP_VERSION_MAX_LENGTH = 32;

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/u;

/** The parts of a well-formed `x.y.z`, or `null` for anything else (a header may be anything). */
export function parseAppVersion(value: unknown): AppVersion | null {
  if (typeof value !== 'string' || value.length > APP_VERSION_MAX_LENGTH) {
    return null;
  }
  const match = VERSION.exec(value.trim());
  if (match === null) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Negative when `a` is lower, zero when equal, positive when higher; numeric, part by part. */
export function compareAppVersions(a: AppVersion, b: AppVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * True only when both are well-formed and `version` is lower than `minimum`. A malformed value on
 * either side is never "below", so a bad header or setting never locks a client out.
 */
export function isBelowMinimum(version: unknown, minimum: unknown): boolean {
  const current = parseAppVersion(version);
  const floor = parseAppVersion(minimum);
  return current !== null && floor !== null && compareAppVersions(current, floor) < 0;
}
