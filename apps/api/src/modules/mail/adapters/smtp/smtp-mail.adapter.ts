import { createTransport } from 'nodemailer';
import type { SendMailOptions, SMTPTransportOptions } from 'nodemailer';
import type { PinoLogger } from 'nestjs-pino';

import type { AdapterKind, DeclaresAdapterKind } from '../../../../config/adapter-kind.js';
import { MailDeliveryError } from '../../ports/mail.port.js';
import type { MailMessage, MailPort } from '../../ports/mail.port.js';

/** The two logger methods the adapter uses (`PinoLogger` in the app, a fake in the specs). */
export type MailLogger = Pick<PinoLogger, 'info' | 'warn'>;

/** What the adapter needs from a nodemailer transporter: SMTP in the app, `jsonTransport` in specs. */
export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<{ readonly messageId?: string }>;
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
}

/** Milliseconds. A dead Mailpit fails a send within seconds instead of the nodemailer minutes. */
export const SMTP_TIMEOUTS = Object.freeze({
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 15_000,
});

/**
 * Plain SMTP to Mailpit: no TLS, no authentication, one connection per message (no pool), and no
 * nodemailer logging, which would print the envelope.
 */
export function smtpTransportOptions(smtp: SmtpSettings): SMTPTransportOptions {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: false,
    ignoreTLS: true,
    ...SMTP_TIMEOUTS,
    logger: false,
    debug: false,
  };
}

/**
 * `MailPort` over SMTP (decision 0005, sections 5 and 6): the local emulator of `dev` and `test`.
 * Logs the template key and the provider message id only, never a recipient, a body or a code.
 */
export class SmtpMailAdapter implements MailPort, DeclaresAdapterKind {
  readonly kind: AdapterKind = 'emulator';

  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
    private readonly logger: MailLogger,
  ) {}

  /** Creates the transporter; nodemailer connects only when a message is sent. */
  static connect(smtp: SmtpSettings, from: string, logger: MailLogger): SmtpMailAdapter {
    return new SmtpMailAdapter(createTransport(smtpTransportOptions(smtp)), from, logger);
  }

  async send(message: MailMessage): Promise<string | undefined> {
    const { templateKey, to, subject, text, html } = message;
    let messageId: string | undefined;
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to,
        subject,
        text,
        ...(html === undefined ? {} : { html }),
      });
      messageId = info.messageId;
    } catch (error) {
      const failure = new MailDeliveryError(templateKey, (error as { code?: unknown }).code);
      this.logger.warn({ templateKey, errorCode: failure.code }, 'mail send failed');
      throw failure;
    }
    this.logger.info({ templateKey, providerMessageId: messageId }, 'mail sent');
    return messageId;
  }
}
