import { roundCoordinate } from './coordinates.js';
import { REDACT_CENSOR } from './redaction.js';

// Matched case-insensitively against the decoded parameter name (decision 0005, section 11).
const COORDINATE_NAMES = new Set(['lat', 'lng', 'latitude', 'longitude']);
const SECRET_NAMES = new Set(['token', 'code']);

// A plain decimal number: no exponent, no hex, no empty string (which `Number()` would accept).
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** `decodeURIComponent` that never throws: malformed percent-encoding returns the raw text. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return text;
  }
}

function sanitizeParameter(pair: string): string {
  const equals = pair.indexOf('=');
  if (equals === -1) {
    return pair;
  }
  const rawName = pair.slice(0, equals);
  const name = safeDecode(rawName).trim().toLowerCase();

  if (SECRET_NAMES.has(name)) {
    return `${rawName}=${REDACT_CENSOR}`;
  }
  if (COORDINATE_NAMES.has(name)) {
    const value = safeDecode(pair.slice(equals + 1)).trim();
    return DECIMAL.test(value)
      ? `${rawName}=${String(roundCoordinate(Number(value)))}`
      : `${rawName}=${REDACT_CENSOR}`;
  }
  return pair;
}

/**
 * The URL of a request as it may appear in a log line (decision 0005, section 11):
 * - `lat`, `lng`, `latitude`, `longitude` rounded to 2 decimals, `[redacted]` when not a number;
 * - the values of `token` and `code` replaced with `[redacted]`;
 * - every other parameter kept as sent, in its order, repeated ones included;
 * - the fragment dropped (a client should never send one, and it could carry a token).
 * Parameter names match case-insensitively after percent-decoding. Never throws.
 */
export function sanitizeUrl(url: string): string {
  const hash = url.indexOf('#');
  const withoutFragment = hash === -1 ? url : url.slice(0, hash);

  const question = withoutFragment.indexOf('?');
  if (question === -1) {
    return withoutFragment;
  }
  const path = withoutFragment.slice(0, question);
  const query = withoutFragment.slice(question + 1);
  if (query === '') {
    return withoutFragment;
  }
  return `${path}?${query.split('&').map(sanitizeParameter).join('&')}`;
}
