import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { Clock, SystemClock } from '../../common/time/clock.js';
import { APP_CONFIG } from '../../config/config.module.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { SocialService } from '../auth/social/social.service.js';
import { StaffLinkService } from '../auth/staff-link.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { MeService } from './me.service.js';
import { PasswordHasher } from './password-hasher.js';
import { UserSessionRevoker, UsersService } from './users.service.js';
import { SessionsService } from './sessions.service.js';
import { UsersModule } from './users.module.js';

/**
 * Stands in for the global `DataSource` that TypeORM registers in the application, and for the
 * global config and pino logger that `MailModule` (imported since A3-T4, as in
 * `auth.module.spec.ts`) reads to bind `MAIL_PORT`. nodemailer connects only on a send, so the
 * loopback port 1 is never reached here.
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

class StubRevoker extends UserSessionRevoker {
  revokeAllSessions(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Stands in for the global `AuthModule`, which exports the real `UserSessionRevoker` and
 * `RefreshTokenService` (used by `SessionsService`, A2-T4) and `SocialService` (used by
 * `MeController`, A2-T6) and `StaffLinkService` (used by `AdminUsersService`, A3-T4).
 */
@Global()
@Module({
  providers: [
    { provide: UserSessionRevoker, useClass: StubRevoker },
    { provide: RefreshTokenService, useValue: {} },
    { provide: SocialService, useValue: {} },
    { provide: StaffLinkService, useValue: {} },
  ],
  exports: [UserSessionRevoker, RefreshTokenService, SocialService, StaffLinkService],
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
    expect(moduleRef.get(AdminUsersService)).toBeInstanceOf(AdminUsersService);
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
