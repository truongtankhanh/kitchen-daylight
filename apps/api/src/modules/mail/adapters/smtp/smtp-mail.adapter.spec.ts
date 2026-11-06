import { randomInt } from 'node:crypto';

import { createTransport } from 'nodemailer';
import type { JSONSentMessageInfo } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import { MailDeliveryError } from '../../ports/mail.port.js';
import type { MailMessage } from '../../ports/mail.port.js';
import { SMTP_TIMEOUTS, SmtpMailAdapter, smtpTransportOptions } from './smtp-mail.adapter.js';
import type { MailLogger, MailTransport } from './smtp-mail.adapter.js';

const FROM = 'no-reply@kitchendaylight.example';
const TO = 'customer@example.com';
// A throw-away code for each run; no code literal in the repository.
const CODE = String(randomInt(0, 1_000_000)).padStart(6, '0');

const MESSAGE: MailMessage = {
  templateKey: 'VERIFY_EMAIL_CODE',
  to: TO,
  subject: 'Mã xác minh email của bạn',
  text: `Mã xác minh email của bạn là: ${CODE}\n`,
};

function fakeLogger() {
  const info = vi.fn();
  const warn = vi.fn();
  return { logger: { info, warn } as unknown as MailLogger, info, warn };
}

/** nodemailer's `jsonTransport`: builds the real message and envelope, opens no socket. */
function recordingJsonTransport() {
  const json = createTransport({ jsonTransport: true });
  const sent: JSONSentMessageInfo[] = [];
  const transport: MailTransport = {
    async sendMail(options) {
      const info = await json.sendMail(options);
      sent.push(info);
      return info;
    },
  };
  return { transport, sent };
}

describe('smtpTransportOptions', () => {
  it('is plain SMTP to the configured address with timeouts and no nodemailer logging', () => {
    expect(smtpTransportOptions({ host: 'mailpit', port: 1025 })).toEqual({
      host: 'mailpit',
      port: 1025,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: SMTP_TIMEOUTS.connectionTimeout,
      greetingTimeout: SMTP_TIMEOUTS.greetingTimeout,
      socketTimeout: SMTP_TIMEOUTS.socketTimeout,
      logger: false,
      debug: false,
    });
  });

  it('sets every timeout to at most 15 seconds', () => {
    for (const timeout of Object.values(SMTP_TIMEOUTS)) {
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(15_000);
    }
  });
});

describe('SmtpMailAdapter', () => {
  it('declares the emulator kind', () => {
    const { transport } = recordingJsonTransport();

    expect(new SmtpMailAdapter(transport, FROM, fakeLogger().logger).kind).toBe('emulator');
  });

  it('sends from MAIL_FROM to the one recipient and returns the message id', async () => {
    const { transport, sent } = recordingJsonTransport();
    const adapter = new SmtpMailAdapter(transport, FROM, fakeLogger().logger);

    const messageId = await adapter.send(MESSAGE);

    expect(sent).toHaveLength(1);
    const [info] = sent;
    expect(info?.envelope).toEqual({ from: FROM, to: [TO] });
    expect(messageId).toBe(info?.messageId);
    expect(messageId).toMatch(/^<.+@.+>$/);

    const composed = JSON.parse(info?.message ?? '{}') as Record<string, unknown>;
    expect(composed['subject']).toBe(MESSAGE.subject);
    expect(composed['text']).toBe(MESSAGE.text);
    expect(composed).not.toHaveProperty('html');
  });

  it('passes the optional HTML part through', async () => {
    const { transport, sent } = recordingJsonTransport();
    const adapter = new SmtpMailAdapter(transport, FROM, fakeLogger().logger);

    await adapter.send({ ...MESSAGE, html: '<p>html part</p>' });

    const composed = JSON.parse(sent[0]?.message ?? '{}') as Record<string, unknown>;
    expect(composed['html']).toBe('<p>html part</p>');
  });

  it('logs the template key and the provider message id only', async () => {
    const { transport } = recordingJsonTransport();
    const { logger, info, warn } = fakeLogger();
    const adapter = new SmtpMailAdapter(transport, FROM, logger);

    const messageId = await adapter.send(MESSAGE);

    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      { templateKey: 'VERIFY_EMAIL_CODE', providerMessageId: messageId },
      'mail sent',
    );
    expect(warn).not.toHaveBeenCalled();
    const logged = JSON.stringify(info.mock.calls);
    for (const secret of [TO, CODE, MESSAGE.text, FROM]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('turns a transport failure into a MailDeliveryError without the recipient', async () => {
    const reply = `Can't send mail - all recipients were rejected: 550 <${TO}> code ${CODE}`;
    const transport: MailTransport = {
      sendMail: () => Promise.reject(Object.assign(new Error(reply), { code: 'EENVELOPE' })),
    };
    const { logger, info, warn } = fakeLogger();
    const adapter = new SmtpMailAdapter(transport, FROM, logger);

    const error = await adapter.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(error).toMatchObject({ templateKey: 'VERIFY_EMAIL_CODE', code: 'EENVELOPE' });
    expect(error).not.toHaveProperty('cause');
    expect(String((error as Error).message)).not.toContain(TO);
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { templateKey: 'VERIFY_EMAIL_CODE', errorCode: 'EENVELOPE' },
      'mail send failed',
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(TO);
    expect(logged).not.toContain(CODE);
  });

  it('drops an error code that is not a plain transport code', async () => {
    const transport: MailTransport = {
      sendMail: () => Promise.reject(Object.assign(new Error('x'), { code: `550 <${TO}>` })),
    };
    const adapter = new SmtpMailAdapter(transport, FROM, fakeLogger().logger);

    const error = await adapter.send(MESSAGE).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: undefined });
    expect(String((error as Error).message)).not.toContain(TO);
  });
});
