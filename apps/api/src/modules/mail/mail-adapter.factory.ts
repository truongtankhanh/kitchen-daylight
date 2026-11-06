import type { AdapterKind } from '../../config/adapter-kind.js';
import type { MailAdapterName } from '../../config/config.schema.js';
import type { MailConfig } from '../../config/load-config.js';
import { SmtpMailAdapter } from './adapters/smtp/smtp-mail.adapter.js';
import type { MailLogger } from './adapters/smtp/smtp-mail.adapter.js';
import type { MailPort } from './ports/mail.port.js';

/**
 * The kind of each `MAIL_ADAPTER` value (decision 0005, section 5). Static, so `main.ts` runs the
 * production guard before Nest boots. A unit test checks each adapter instance against it.
 */
export const MAIL_ADAPTER_KINDS: Readonly<Record<MailAdapterName, AdapterKind>> = Object.freeze({
  smtp: 'emulator',
  // SES (A12-T4); no adapter yet, so `createMailAdapter` refuses it.
  ses: 'real',
});

/** `MAIL_ADAPTER` names an adapter that this build does not ship. */
export class MailAdapterUnavailableError extends Error {
  constructor(adapter: MailAdapterName) {
    super(`MAIL_ADAPTER: ${adapter} is not available yet`);
    this.name = 'MailAdapterUnavailableError';
  }
}

/** Picks the `MailPort` adapter from the validated config (decision 0005, section 6). */
export function createMailAdapter(config: MailConfig, logger: MailLogger): MailPort {
  switch (config.adapter) {
    case 'smtp':
      return SmtpMailAdapter.connect(config.smtp, config.from, logger);
    case 'ses':
      // A12-T4 adds the SES adapter. Until then `demo` and `prod` cannot boot with mail.
      throw new MailAdapterUnavailableError(config.adapter);
  }
}
