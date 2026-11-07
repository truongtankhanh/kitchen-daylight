import { ApiSchema } from '@nestjs/swagger';

import type { MfaSetup } from '../mfa.service.js';

/** Body of `POST /me/mfa/setup`, shown once: the secret is never returned again. */
@ApiSchema({ name: 'MfaSetup' })
export class MfaSetupDto implements MfaSetup {
  /** `otpauth://totp/…` for the QR code (issuer `Kitchen Daylight`, label the email). */
  otpauthUri!: string;

  /** The same secret in Base32, for typing into an authenticator app by hand. */
  secret!: string;
}
