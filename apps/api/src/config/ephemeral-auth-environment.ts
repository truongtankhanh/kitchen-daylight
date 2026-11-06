import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';

/** The required auth variables of the server (decision 0008, section 12). */
export const REQUIRED_AUTH_VARIABLES = [
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_KEY_ID',
  'OTP_HMAC_SECRET',
  'MFA_ENCRYPTION_KEY',
] as const;
export type RequiredAuthVariable = (typeof REQUIRED_AUTH_VARIABLES)[number];

/**
 * Throw-away values for every required auth variable, generated with `node:crypto` on each call,
 * in the formats of `scripts/env-sync.sh` and the Docker repository's `gen-dev-secrets.sh`: the
 * base64 of a PKCS#8 and an SPKI PEM on curve P-256, a `kid` of the prefix plus the first 16 hex
 * digits of the SHA-256 of the SPKI DER, and 32 random bytes in base64 for each secret.
 *
 * For processes that must boot the server configuration without a secret: the OpenAPI generator
 * and the tests. Never used by `main.ts`. No key literal is committed anywhere (decision 0004
 * section 1; the repository is public and scanned by gitleaks).
 */
export function createEphemeralAuthEnvironment(
  keyIdPrefix = 'kd-ephemeral-',
): Readonly<Record<RequiredAuthVariable, string>> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);

  return Object.freeze({
    JWT_PRIVATE_KEY: Buffer.from(privatePem).toString('base64'),
    JWT_PUBLIC_KEY: Buffer.from(publicPem).toString('base64'),
    JWT_KEY_ID: `${keyIdPrefix}${fingerprint}`,
    OTP_HMAC_SECRET: randomBytes(32).toString('base64'),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
}
