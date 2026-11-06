import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

import { normalizePassword } from './password-policy.js';

/** argon2id parameters, in the units of `crypto.argon2` (memory in KiB, lengths in bytes). */
export interface PasswordHashParameters {
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly tagLength: number;
  readonly saltLength: number;
}

/**
 * OWASP's second argon2id configuration (decision 0008 section 4 [S1]): a minimum, not a ceiling.
 * Raised only after measuring the production instance; never lowered. A change makes
 * `needsRehash` true for every older hash, which is re-hashed at the next login.
 */
export const PASSWORD_HASH_PARAMETERS: PasswordHashParameters = {
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
  saltLength: 16,
};

/** Argon2 version 1.3, the only one `crypto.argon2` computes. */
const ARGON2_VERSION = 19;

const PHC_PATTERN =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface ParsedPhc {
  readonly version: number;
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

/** Unpadded standard base64, as the PHC string format uses. */
function toPhcBase64(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

function positiveInteger(text: string): number | null {
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Parses what `encodePhc` writes; `null` for anything else. Never echoes the input. */
export function parsePhc(phc: string): ParsedPhc | null {
  const match = PHC_PATTERN.exec(phc);
  if (match === null) {
    return null;
  }
  const version = positiveInteger(match[1] ?? '');
  const memory = positiveInteger(match[2] ?? '');
  const passes = positiveInteger(match[3] ?? '');
  const parallelism = positiveInteger(match[4] ?? '');
  const salt = match[5];
  const hash = match[6];
  if (
    version === null ||
    memory === null ||
    passes === null ||
    parallelism === null ||
    salt === undefined ||
    hash === undefined
  ) {
    return null;
  }
  return {
    version,
    memory,
    passes,
    parallelism,
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  };
}

/** `$argon2id$v=19$m=<m>,t=<t>,p=<p>$<salt>$<hash>`. */
export function encodePhc(
  parameters: Pick<PasswordHashParameters, 'memory' | 'passes' | 'parallelism'>,
  salt: Buffer,
  hash: Buffer,
): string {
  const { memory, passes, parallelism } = parameters;
  return `$argon2id$v=${ARGON2_VERSION}$m=${memory},t=${passes},p=${parallelism}$${toPhcBase64(salt)}$${toPhcBase64(hash)}`;
}

/** One argon2id derivation on the libuv thread pool, never on the event loop. */
function deriveArgon2id(
  password: string,
  salt: Buffer,
  parameters: Pick<PasswordHashParameters, 'memory' | 'passes' | 'parallelism' | 'tagLength'>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        // The UTF-8 bytes of the NFC form (decision 0008 section 4).
        message: Buffer.from(normalizePassword(password), 'utf8'),
        nonce: salt,
        memory: parameters.memory,
        passes: parameters.passes,
        parallelism: parameters.parallelism,
        tagLength: parameters.tagLength,
      },
      (error, derived) => {
        if (error) {
          reject(error);
        } else {
          resolve(derived);
        }
      },
    );
  });
}

/**
 * Password hashing with argon2id from `node:crypto` and a PHC string helper (decision 0008
 * section 4: no dependency, no native addon). No pepper. A password, a hash or a derived key is
 * never logged or put in an error message.
 */
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  constructor(private readonly parameters: PasswordHashParameters = PASSWORD_HASH_PARAMETERS) {}

  /** A new random salt each time, so two hashes of one password differ. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(this.parameters.saltLength);
    const derived = await deriveArgon2id(password, salt, this.parameters);
    return encodePhc(this.parameters, salt, derived);
  }

  /**
   * Re-derives with the parameters stored in `phc` and compares in constant time. Throws (without
   * the value) when `phc` is not a hash this class writes: a corrupt row is a defect, not a wrong
   * password.
   */
  async verify(phc: string, password: string): Promise<boolean> {
    const parsed = parsePhc(phc);
    if (parsed === null || parsed.version !== ARGON2_VERSION) {
      throw new Error('The stored password hash is not a supported argon2id PHC string.');
    }
    const derived = await deriveArgon2id(password, parsed.salt, {
      memory: parsed.memory,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagLength: parsed.hash.length,
    });
    return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
  }

  /** True when `phc` was made with other parameters (or cannot be read): hash again at login. */
  needsRehash(phc: string): boolean {
    const parsed = parsePhc(phc);
    return (
      parsed === null ||
      parsed.version !== ARGON2_VERSION ||
      parsed.memory !== this.parameters.memory ||
      parsed.passes !== this.parameters.passes ||
      parsed.parallelism !== this.parameters.parallelism ||
      parsed.salt.length !== this.parameters.saltLength ||
      parsed.hash.length !== this.parameters.tagLength
    );
  }

  /**
   * `verify` for a real hash; for `null` (unknown email, no password, or any other refusal the
   * caller hides) one verification against a dummy hash with the current parameters, then `false`.
   * Both go through `verify`, so the response time does not tell the cases apart (decision 0008
   * section 4 [S2]). The dummy hash is made on first use, never at import.
   */
  async verifyOrDummy(phc: string | null, password: string): Promise<boolean> {
    if (phc === null) {
      await this.verify(await this.dummy(), password);
      return false;
    }
    return this.verify(phc, password);
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url')).catch((error: unknown) => {
      this.dummyHash = undefined;
      throw error;
    });
    return this.dummyHash;
  }
}
