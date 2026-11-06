import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { ThrottlingModule } from '../../common/throttling/throttling.module.js';
import { clockProvider } from '../../common/time/clock.js';
import type { AuthConfig } from '../../config/load-config.js';
import { AuditModule } from '../audit/audit.module.js';
import { LegalModule } from '../legal/legal.module.js';
import { MailModule } from '../mail/mail.module.js';
import { UsersModule } from '../users/users.module.js';
import { UserSessionRevoker } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthCodesController } from './auth-codes.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EMAIL_CODE_HMAC_KEY, EmailCodeService } from './email-code.service.js';
import { JWT_KEY_CONFIG, KeySet } from './key-set.js';
import { RefreshTokenService } from './refresh-token.service.js';

/**
 * Tokens (A1-T6): the key set, access tokens and refresh tokens; the customer auth endpoints
 * (A2-T1: `AuthController`, `AuthService`, with `UsersModule` and `LegalModule`). No cookie
 * transport yet (A3-T1). Global, because `UsersModule` resolves `UserSessionRevoker` from it: the
 * real revocation replaces the fail-closed binding of A1-T5, and an application that imports
 * `UsersModule` without this module does not boot. Imported once, by `AppModule`, with the
 * validated `config.auth` (A1-T7: the global `AuthGuard` verifies access tokens with it).
 * Email codes (A2-T2: `AuthCodesController`, `EmailCodeService`) bring `MailModule` (A1-T8), the
 * first module to bind `MAIL_PORT` in the application, and `ThrottlingModule` for the per-account
 * resend rule.
 */
@Module({})
export class AuthModule {
  static forRoot(auth: AuthConfig): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      imports: [AuditModule, UsersModule, LegalModule, MailModule, ThrottlingModule],
      controllers: [AuthController, AuthCodesController],
      providers: [
        AuthService,
        EmailCodeService,
        // The bytes of `OTP_HMAC_SECRET` (base64, at least 32, validated by `loadConfig`).
        { provide: EMAIL_CODE_HMAC_KEY, useValue: Buffer.from(auth.otpHmacSecret, 'base64') },
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
