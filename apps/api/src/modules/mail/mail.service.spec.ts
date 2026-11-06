import { describe, expect, it, vi } from 'vitest';

import { MailService } from './mail.service.js';
import { MailDeliveryError } from './ports/mail.port.js';
import type { MailMessage, MailPort } from './ports/mail.port.js';

const MESSAGE: MailMessage = {
  templateKey: 'VERIFY_EMAIL_CODE',
  to: 'customer@example.com',
  subject: 'subject',
  text: 'text',
};

describe('MailService', () => {
  it('hands the message to the bound port and returns its message id', async () => {
    const send = vi.fn<MailPort['send']>().mockResolvedValue('<id@kitchendaylight.example>');
    const service = new MailService({ send });

    await expect(service.send(MESSAGE)).resolves.toBe('<id@kitchendaylight.example>');
    expect(send).toHaveBeenCalledExactlyOnceWith(MESSAGE);
  });

  it('passes a provider without a message id through as undefined', async () => {
    const service = new MailService({
      send: vi.fn<MailPort['send']>().mockResolvedValue(undefined),
    });

    await expect(service.send(MESSAGE)).resolves.toBeUndefined();
  });

  it('lets a delivery failure through', async () => {
    const failure = new MailDeliveryError('VERIFY_EMAIL_CODE', 'ECONNECTION');
    const service = new MailService({ send: vi.fn<MailPort['send']>().mockRejectedValue(failure) });

    await expect(service.send(MESSAGE)).rejects.toBe(failure);
  });
});
