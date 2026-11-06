import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { clockProvider } from '../../common/time/clock.js';
import type { AuthConfig } from '../../config/load-config.js';
import { AuditModule } from '../audit/audit.module.js';
import { UserSessionRevoker } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { JWT_KEY_CONFIG, KeySet } from './key-set.js';
import { RefreshTokenService } from './refresh-token.service.js';

/**
 * Tokens (A1-T6): the key set, access tokens and refresh tokens. No endpoint, cookie or guard
 * (A2-T1, A3-T1, A1-T7). Global, because `UsersModule` resolves `UserSessionRevoker` from it: the
 * real revocation replaces the fail-closed binding of A1-T5, and an application that imports
 * `UsersModule` without this module does not boot. Imported once, by `AppModule`, with the
 * validated `config.auth` (A2-T1).
 */
@Module({})
export class AuthModule {
  static forRoot(auth: AuthConfig): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      imports: [AuditModule],
      providers: [
        { provide: JWT_KEY_CONFIG, useValue: auth.jwt },
        KeySet,
        AccessTokenService,
        RefreshTokenService,
        { provide: UserSessionRevoker, useExisting: RefreshTokenService },
        clockProvider,
      ],
      exports: [AccessTokenService, RefreshTokenService, UserSessionRevoker],
    };
  }
}
