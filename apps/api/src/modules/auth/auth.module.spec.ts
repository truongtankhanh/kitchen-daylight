import { generateKeyPairSync } from 'node:crypto';

import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../../config/config.module.js';
import type { AuthConfig } from '../../config/load-config.js';
import { UserSessionRevoker } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthModule } from './auth.module.js';
import { RefreshTokenService } from './refresh-token.service.js';

/**
 * Stands in for the global `DataSource` that TypeORM registers in the application, and for the
 * global config and pino logger that `MailModule` (imported since A2-T2) reads to bind `MAIL_PORT`.
 * nodemailer connects only on a send, so the loopback port 1 is never reached here.
 */
@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: {} },
    {
      provide: APP_CONFIG,
      useValue: {
        mail: {
          adapter: 'smtp',
          from: 'no-reply@kitchendaylight.example',
          smtp: { host: '127.0.0.1', port: 1 },
        },
      },
    },
    { provide: PinoLogger, useValue: { setContext: () => undefined } },
  ],
  exports: [DataSource, APP_CONFIG, PinoLogger],
})
class StubDataSourceModule {}

/** Only `jwt` is read by this module; the other members are placeholders. */
function authConfig(): AuthConfig {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const base64 = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');
  return {
    jwt: {
      keyId: 'kd-test-module',
      privateKey: base64(privateKey.export({ type: 'pkcs8', format: 'pem' })),
      publicKey: base64(publicKey.export({ type: 'spki', format: 'pem' })),
      previousPublicKeys: [],
    },
    otpHmacSecret: 'unused-in-this-spec',
    mfaEncryption: { key: 'unused-in-this-spec', previousKeys: [] },
    social: { googleClientIds: [], appleClientIds: [] },
  };
}

describe('AuthModule', () => {
  it('imports the keys at init and binds UserSessionRevoker to RefreshTokenService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, AuthModule.forRoot(authConfig())],
    }).compile();
    await moduleRef.init();

    const access = moduleRef.get(AccessTokenService);
    const { token } = await access.sign({
      userId: '01930000-0000-7000-8000-0000000000f1',
      role: 'CUSTOMER',
      sessionId: '01930000-0000-7000-8000-0000000000f2',
    });
    await expect(access.verify(token)).resolves.toMatchObject({ role: 'CUSTOMER' });

    const refresh = moduleRef.get(RefreshTokenService);
    expect(moduleRef.get(UserSessionRevoker)).toBe(refresh);

    await moduleRef.close();
  });
});
