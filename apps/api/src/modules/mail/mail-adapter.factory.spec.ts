import { describe, expect, it, vi } from 'vitest';

import { ADAPTER_KINDS } from '../../config/adapter-kind.js';
import { MAIL_ADAPTERS } from '../../config/config.schema.js';
import { SmtpMailAdapter } from './adapters/smtp/smtp-mail.adapter.js';
import type { MailLogger } from './adapters/smtp/smtp-mail.adapter.js';
import {
  createMailAdapter,
  MAIL_ADAPTER_KINDS,
  MailAdapterUnavailableError,
} from './mail-adapter.factory.js';

const LOGGER = { info: vi.fn(), warn: vi.fn() } as unknown as MailLogger;
const FROM = 'no-reply@kitchendaylight.example';

describe('MAIL_ADAPTER_KINDS', () => {
  it('declares one known kind for every MAIL_ADAPTER value', () => {
    expect(Object.keys(MAIL_ADAPTER_KINDS).sort()).toEqual([...MAIL_ADAPTERS].sort());
    for (const kind of Object.values(MAIL_ADAPTER_KINDS)) {
      expect(ADAPTER_KINDS).toContain(kind);
    }
  });

  it('marks ses real, as decision 0005 section 5 does', () => {
    expect(MAIL_ADAPTER_KINDS.ses).toBe('real');
  });
});

describe('createMailAdapter', () => {
  it('binds smtp to the SMTP adapter, whose declared kind equals the table entry', () => {
    // Creating the transporter opens no connection: nothing listens on port 1.
    const adapter = createMailAdapter(
      { adapter: 'smtp', from: FROM, smtp: { host: '127.0.0.1', port: 1 } },
      LOGGER,
    );

    expect(adapter).toBeInstanceOf(SmtpMailAdapter);
    expect((adapter as SmtpMailAdapter).kind).toBe(MAIL_ADAPTER_KINDS.smtp);
  });

  it('refuses ses as not available yet (A12-T4)', () => {
    expect(() => createMailAdapter({ adapter: 'ses', from: FROM }, LOGGER)).toThrow(
      new MailAdapterUnavailableError('ses'),
    );
    expect(() => createMailAdapter({ adapter: 'ses', from: FROM }, LOGGER)).toThrow(
      'MAIL_ADAPTER: ses is not available yet',
    );
  });
});
