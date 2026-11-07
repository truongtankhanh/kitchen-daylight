/** Replacement written by pino for every redacted value (decision 0005, section 11). */
export const REDACT_CENSOR = '[redacted]';

/**
 * pino `redact` paths: the list of decision 0005 section 11, then the names each slice appends in
 * the same change as its code. `*.` matches one level, so application logs pass flat objects
 * (`logger.info({ payload: { … } })`).
 *
 * A2-T2 (email codes) appends `*.emailCode`, the name under which a code may be passed to a log
 * call. `*.code` is deliberately absent (owner decision, 2026-11-06): it would also censor the
 * `code` of every serialized error (`err.code`: SQLSTATE, Node error code, catalogue code;
 * `error-serializer.ts`). The request field `code` never reaches a log line, because no body is
 * logged (`request-serializer.ts`), and no log call passes an email code under `code`.
 *
 * A2-T6 (social sign-in) appends `*.nonce` (decision 0008, Consequences). `*.recoveryCode` arrives
 * with the MFA task of A3 that introduces the field. The differences from 0008 are api-divergences
 * D-074.
 */
export const REDACT_PATHS = [
  // Headers.
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // Fields.
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.secret',
  '*.privateKey',
  '*.apiKey',
  '*.otp',
  '*.databaseUrl',
  // A2-T2: the 6-digit email code.
  '*.emailCode',
  // A2-T6: the social sign-in nonce.
  '*.nonce',
] as const;

/** The `redact` option of pino, built from the list above. */
export function redactOptions(): { paths: string[]; censor: string } {
  return { paths: [...REDACT_PATHS], censor: REDACT_CENSOR };
}
