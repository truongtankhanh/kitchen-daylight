import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { APP_CONFIG } from '../../config/config.module.js';
import type { ServerConfig } from '../../config/load-config.js';
import { createMailAdapter } from './mail-adapter.factory.js';
import { MailService } from './mail.service.js';
import { MAIL_PORT } from './ports/mail.port.js';

/**
 * Binds `MAIL_PORT` to the adapter named by `MAIL_ADAPTER` (decision 0005, section 6). Exports the
 * token and `MailService`, never an adapter class. The production guard checks the binding in
 * `main.ts` before Nest boots (`config/production-guard.ts`).
 */
@Module({
  providers: [
    {
      provide: MAIL_PORT,
      inject: [APP_CONFIG, PinoLogger],
      useFactory: (config: ServerConfig, logger: PinoLogger) => {
        logger.setContext('MailPort');
        return createMailAdapter(config.mail, logger);
      },
    },
    MailService,
  ],
  exports: [MAIL_PORT, MailService],
})
export class MailModule {}
