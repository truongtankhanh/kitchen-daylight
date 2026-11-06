import { Module } from '@nestjs/common';

import { clockProvider } from '../../common/time/clock.js';
import { PasswordHasher } from './password-hasher.js';
import { PendingUserSessionRevoker, UserSessionRevoker, UsersService } from './users.service.js';

/**
 * Accounts and credentials (A1-T5). Uses the application's global TypeORM `DataSource`. Not imported
 * by `AppModule` yet: the first auth slice (A2-T1) imports it. `UserSessionRevoker` is bound to
 * the fail-closed `PendingUserSessionRevoker` until the token service (A1-T6) provides the real one.
 */
@Module({
  providers: [
    UsersService,
    // A factory, so Nest does not try to resolve the optional parameters argument.
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    { provide: UserSessionRevoker, useClass: PendingUserSessionRevoker },
    clockProvider,
  ],
  exports: [UsersService, PasswordHasher],
})
export class UsersModule {}
