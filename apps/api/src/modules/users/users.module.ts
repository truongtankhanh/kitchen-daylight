import { Module } from '@nestjs/common';

import { clockProvider } from '../../common/time/clock.js';
import { AuditModule } from '../audit/audit.module.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

/**
 * Accounts and credentials (A1-T5), and the signed-in user's own account (A2-T4: `MeController`,
 * `MeService`, `SessionsService`). Uses the application's global TypeORM `DataSource`. Imported by
 * the global `AuthModule` and by `AppModule`. `UserSessionRevoker` and `RefreshTokenService` come
 * from the global `AuthModule` (A1-T6); without it the module does not resolve, so a suspension can
 * never run without revoking sessions.
 */
@Module({
  imports: [AuditModule],
  controllers: [MeController],
  providers: [
    UsersService,
    MeService,
    SessionsService,
    // A factory, so Nest does not try to resolve the optional parameters argument.
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    clockProvider,
  ],
  exports: [UsersService, PasswordHasher],
})
export class UsersModule {}
