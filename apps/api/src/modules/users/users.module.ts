import { Module } from '@nestjs/common';

import { clockProvider } from '../../common/time/clock.js';
import { AuditModule } from '../audit/audit.module.js';
import { MailModule } from '../mail/mail.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AddressesController } from './addresses.controller.js';
import { AddressesService } from './addresses.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { CUSTOMER_STATS_PORT, NoOrdersCustomerStats } from './customer-stats.port.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

/**
 * Accounts and credentials (A1-T5), the signed-in user's own account (A2-T4: `MeController`,
 * `MeService`, `SessionsService`) and address book (A2-T5: `AddressesController`,
 * `AddressesService`). Uses the application's global TypeORM `DataSource`. Imported by the global
 * `AuthModule` and by `AppModule`. `UserSessionRevoker` and `RefreshTokenService` come
 * from the global `AuthModule` (A1-T6); without it the module does not resolve, so a suspension can
 * never run without revoking sessions. `SocialService` (the `/me/identities` routes of
 * `MeController`, A2-T6) comes from the global `AuthModule` too.
 * Admin user management (A3-T4: `AdminUsersController`, `AdminUsersService`) uses
 * `StaffLinkService` from the global `AuthModule`, the outbox writer (`RealtimeModule`) and mail.
 * `CUSTOMER_STATS_PORT` is bound to `NoOrdersCustomerStats` until A8 (orders) and A15 (loyalty)
 * bind the real figures.
 */
@Module({
  imports: [AuditModule, RealtimeModule, MailModule],
  controllers: [MeController, AddressesController, AdminUsersController],
  providers: [
    UsersService,
    MeService,
    SessionsService,
    AddressesService,
    AdminUsersService,
    { provide: CUSTOMER_STATS_PORT, useClass: NoOrdersCustomerStats },
    // A factory, so Nest does not try to resolve the optional parameters argument.
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    clockProvider,
  ],
  exports: [UsersService, PasswordHasher],
})
export class UsersModule {}
