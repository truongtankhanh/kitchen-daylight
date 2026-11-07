import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { Clock, SystemClock } from '../../common/time/clock.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { SocialService } from '../auth/social/social.service.js';
import { MeService } from './me.service.js';
import { PasswordHasher } from './password-hasher.js';
import { UserSessionRevoker, UsersService } from './users.service.js';
import { SessionsService } from './sessions.service.js';
import { UsersModule } from './users.module.js';

/** Stands in for the global `DataSource` that TypeORM registers in the application. */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class StubDataSourceModule {}

class StubRevoker extends UserSessionRevoker {
  revokeAllSessions(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Stands in for the global `AuthModule`, which exports the real `UserSessionRevoker` and
 * `RefreshTokenService` (used by `SessionsService`, A2-T4) and `SocialService` (used by
 * `MeController`, A2-T6).
 */
@Global()
@Module({
  providers: [
    { provide: UserSessionRevoker, useClass: StubRevoker },
    { provide: RefreshTokenService, useValue: {} },
    { provide: SocialService, useValue: {} },
  ],
  exports: [UserSessionRevoker, RefreshTokenService, SocialService],
})
class StubAuthModule {}

describe('UsersModule', () => {
  it('provides UsersService and PasswordHasher with the session revoker of the auth module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, StubAuthModule, UsersModule],
    }).compile();

    expect(moduleRef.get(UsersService)).toBeInstanceOf(UsersService);
    expect(moduleRef.get(PasswordHasher)).toBeInstanceOf(PasswordHasher);
    expect(moduleRef.get(MeService)).toBeInstanceOf(MeService);
    expect(moduleRef.get(SessionsService)).toBeInstanceOf(SessionsService);
    expect(moduleRef.get(UserSessionRevoker, { strict: false })).toBeInstanceOf(StubRevoker);
    expect(moduleRef.get(Clock, { strict: false })).toBeInstanceOf(SystemClock);

    await moduleRef.close();
  });

  it('does not resolve without a UserSessionRevoker, so it cannot run without revocation', async () => {
    await expect(
      Test.createTestingModule({ imports: [StubDataSourceModule, UsersModule] }).compile(),
    ).rejects.toThrow(/UserSessionRevoker/);
  });
});
