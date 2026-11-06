import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { importPKCS8, importSPKI } from 'jose';

import type { AuthConfig } from '../../config/load-config.js';

/** The JWT part of the server configuration (decision 0008 sections 9 and 12). */
export type JwtKeyConfig = AuthConfig['jwt'];

/** Injection token of the `JwtKeyConfig` that `AuthModule.forRoot` provides. */
export const JWT_KEY_CONFIG = Symbol('JWT_KEY_CONFIG');

/** The only algorithm signed and accepted (decision 0008 section 9). */
export const ACCESS_TOKEN_ALGORITHM = 'ES256';

export type JoseKey = Awaited<ReturnType<typeof importSPKI>>;

function pemOf(base64Pem: string): string {
  return Buffer.from(base64Pem, 'base64').toString('utf8');
}

/**
 * The access-token keys, imported with `jose` once in `onModuleInit` (never at import time, so the
 * OpenAPI generator and the CLI load the module without touching a key). The current pair signs;
 * the current public key and every `JWT_PREVIOUS_PUBLIC_KEYS` entry verify, indexed by `kid`, so a
 * token signed before a rotation verifies until its TTL ends (decision 0008 section 9). No key or
 * PEM is logged or put in an error message.
 */
@Injectable()
export class KeySet implements OnModuleInit {
  private signing: { readonly keyId: string; readonly key: JoseKey } | undefined;
  private verifying = new Map<string, JoseKey>();

  constructor(@Inject(JWT_KEY_CONFIG) private readonly config: JwtKeyConfig) {}

  async onModuleInit(): Promise<void> {
    const { keyId, privateKey, publicKey, previousPublicKeys } = this.config;
    const verifying = new Map<string, JoseKey>();
    for (const previous of previousPublicKeys) {
      verifying.set(
        previous.keyId,
        await importSPKI(pemOf(previous.publicKey), ACCESS_TOKEN_ALGORITHM),
      );
    }
    // The current key last, so it wins over a previous entry with the same kid.
    verifying.set(keyId, await importSPKI(pemOf(publicKey), ACCESS_TOKEN_ALGORITHM));
    const key = await importPKCS8(pemOf(privateKey), ACCESS_TOKEN_ALGORITHM);

    this.verifying = verifying;
    this.signing = { keyId, key };
  }

  /** The current private key and its `kid`. */
  signingKey(): { readonly keyId: string; readonly key: JoseKey } {
    if (this.signing === undefined) {
      throw new Error('KeySet is used before onModuleInit imported the keys.');
    }
    return this.signing;
  }

  /** The public key of `kid`, or `undefined` for an unknown `kid`. */
  verificationKey(keyId: string): JoseKey | undefined {
    return this.verifying.get(keyId);
  }
}
