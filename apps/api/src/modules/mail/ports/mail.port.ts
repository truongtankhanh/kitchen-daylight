// Decision 0005, section 6: a port is an interface plus an injection token in its owning module.
// Other modules inject `MAIL_PORT` (or `MailService`), never an adapter class.

/** Injection token of the bound `MailPort` adapter. */
export const MAIL_PORT = Symbol('MAIL_PORT');

/**
 * Template keys of data-model `email_templates`. Each key is added with its template; the table
 * itself arrives in A12-T3.
 */
export type MailTemplateKey = 'VERIFY_EMAIL_CODE' | 'PASSWORD_RESET_CODE';

export interface MailMessage {
  /** Logged by the adapter in place of any content. */
  readonly templateKey: MailTemplateKey;
  /** One recipient address. Never logged. */
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface MailPort {
  /** Sends one message; resolves to the provider message id when the provider returns one. */
  send(message: MailMessage): Promise<string | undefined>;
}

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,31}$/;

/**
 * A send that failed. The message names the template and the transport's error code only: a
 * provider error can quote the recipient or the server reply, so it is neither kept nor chained.
 */
export class MailDeliveryError extends Error {
  readonly templateKey: MailTemplateKey;
  readonly code: string | undefined;

  constructor(templateKey: MailTemplateKey, code: unknown) {
    const safeCode = typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : undefined;
    super(`mail delivery failed (template ${templateKey}, code ${safeCode ?? 'unknown'})`);
    this.name = 'MailDeliveryError';
    this.templateKey = templateKey;
    this.code = safeCode;
  }
}
