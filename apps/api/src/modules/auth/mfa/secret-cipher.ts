import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption of `mfa_credentials.secret_encrypted` (decision 0008 section 8): AES-256-GCM, a
 * 12-byte random IV per value, a 16-byte tag, associated data `kd.mfa.v1:<user id>` so a value
 * copied to another user's row does not decrypt. Stored text `v1.<kid>.<iv>.<ciphertext>.<tag>`,
 * each part base64url without padding (the `mfa_credentials_secret_layout` CHECK). The key id is
 * derived from the key, so rotation needs no extra variable: `MFA_ENCRYPTION_KEY` encrypts,
 * `MFA_ENCRYPTION_PREVIOUS_KEYS` only decrypt. No key, secret or plaintext is ever logged or put in
 * an error message.
 */
const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KID_HEX_DIGITS = 16;
const STORED_PATTERN =
  /^v1\.([0-9a-f]{16})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/;

/** First 16 hex digits of SHA-256(`kd.mfa.kid\n` ‖ key bytes). */
export function mfaKeyIdOf(key: Buffer): string {
  return createHash('sha256')
    .update('kd.mfa.kid\n')
    .update(key)
    .digest('hex')
    .slice(0, KID_HEX_DIGITS);
}

function associatedDataOf(userId: string): Buffer {
  return Buffer.from(`kd.mfa.${VERSION}:${userId}`, 'utf8');
}

function keyFrom(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    // `loadConfig` already refuses such a key; the message never repeats it.
    throw new Error(`An MFA encryption key must be ${KEY_BYTES} bytes.`);
  }
  return key;
}

export interface DecryptedSecret {
  readonly plaintext: Buffer;
  /** False when a previous key decrypted it: re-encrypt with the current key. */
  readonly current: boolean;
}

export class SecretCipher {
  private readonly keyId: string;
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(
    private readonly key: Buffer,
    previousKeys: readonly Buffer[] = [],
  ) {
    this.keyId = mfaKeyIdOf(key);
    const keys = new Map<string, Buffer>();
    for (const previous of previousKeys) {
      keys.set(mfaKeyIdOf(previous), previous);
    }
    keys.set(this.keyId, key);
    this.keys = keys;
  }

  /** From the validated `config.auth.mfaEncryption` (base64 keys). No I/O. */
  static fromConfig(config: {
    readonly key: string;
    readonly previousKeys: readonly string[];
  }): SecretCipher {
    return new SecretCipher(keyFrom(config.key), config.previousKeys.map(keyFrom));
  }

  encrypt(plaintext: Buffer, userId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(associatedDataOf(userId));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      this.keyId,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  /**
   * Throws (without the value) when the text is not in the stored layout, its key is unknown, or
   * the tag does not verify (tampered, or another user's row): a defect, never a wrong code.
   */
  decrypt(stored: string, userId: string): DecryptedSecret {
    const match = STORED_PATTERN.exec(stored);
    if (match === null) {
      throw new Error('The stored MFA secret is not in the v1 layout.');
    }
    const [, kid = '', iv = '', ciphertext = '', tag = ''] = match;
    const key = this.keys.get(kid);
    if (key === undefined) {
      throw new Error('The stored MFA secret was encrypted with an unknown key.');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(associatedDataOf(userId));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]);
      return { plaintext, current: kid === this.keyId };
    } catch {
      throw new Error('The stored MFA secret failed authentication.');
    }
  }
}
