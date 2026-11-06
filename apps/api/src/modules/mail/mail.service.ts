import { Inject, Injectable } from '@nestjs/common';

import { MAIL_PORT } from './ports/mail.port.js';
import type { MailMessage, MailPort } from './ports/mail.port.js';

/** What other modules inject to send mail; the bound adapter stays behind `MAIL_PORT`. */
@Injectable()
export class MailService {
  constructor(@Inject(MAIL_PORT) private readonly mail: MailPort) {}

  /** Resolves to the provider message id when there is one; throws `MailDeliveryError`. */
  send(message: MailMessage): Promise<string | undefined> {
    return this.mail.send(message);
  }
}
