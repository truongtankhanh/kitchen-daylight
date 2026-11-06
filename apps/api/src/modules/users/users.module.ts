import { Module } from '@nestjs/common';

import { clockProvider } from '../../common/time/clock.js';
import { PasswordHasher } from './password-hasher.js';
import { UsersService } from './users.service.js';

/**
 * Accounts and credentials (A1-T5). Uses the application's global TypeORM `DataSource`. Not imported
 * by `AppModule` yet: the first auth slice (A2-T1) imports it. `UserSessionRevoker` comes from the
 * global `AuthModule` (A1-T6, `RefreshTokenService`); without it the module does not resolve, so a
 * suspension can never run without revoking sessions.
 */
@Module({
  providers: [
    UsersService,
    // A factory, so Nest does not try to resolve the optional parameters argument.
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    clockProvider,
  ],
  exports: [UsersService, PasswordHasher],
})
export class UsersModule {}
