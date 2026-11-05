/** Replacement written by pino for every redacted value (decision 0005, section 11). */
export const REDACT_CENSOR = '[redacted]';

/**
 * pino `redact` paths, exactly as decision 0005 section 11. `*.` matches one level, so application
 * logs pass flat objects (`logger.info({ payload: { … } })`). Each slice appends the field names it
 * introduces (for example the email-code field of auth) in the same change as the code.
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
] as const;

/** The `redact` option of pino, built from the list above. */
export function redactOptions(): { paths: string[]; censor: string } {
  return { paths: [...REDACT_PATHS], censor: REDACT_CENSOR };
}
