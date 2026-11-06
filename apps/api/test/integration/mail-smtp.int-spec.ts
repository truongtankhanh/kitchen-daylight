import { randomInt, randomUUID } from 'node:crypto';

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LoggingModule } from '../../src/common/logging/logging.module.js';
import { AppConfigModule } from '../../src/config/config.module.js';
import { readEnvironment } from '../../src/config/env-file.js';
import { createEphemeralAuthEnvironment } from '../../src/config/ephemeral-auth-environment.js';
import { loadConfig } from '../../src/config/load-config.js';
import { productionGuardViolations } from '../../src/config/production-guard.js';
import { MailModule } from '../../src/modules/mail/mail.module.js';
import { MAIL_PORT } from '../../src/modules/mail/ports/mail.port.js';
import type { MailPort } from '../../src/modules/mail/ports/mail.port.js';
import { renderVerifyEmailCode } from '../../src/modules/mail/templates/verify-email-code.template.js';
import { ROOT_ENV_FILE } from '../support/test-database.js';

// A1-T8: one message through `MailPort` (SMTP adapter, real `MailModule` wiring) to the Mailpit of
// the dev stack, found again through Mailpit's REST API v1 (`GET /api/v1/search`,
// `GET /api/v1/message/{ID}`) and then deleted by its own ID (`DELETE /api/v1/messages` with
// `IDs`; an empty body would delete every message, so the spec never sends one).
// `MAIL_UI_URL` is read here, by the test, never by the API (decision 0005, section 2).

const env = readEnvironment(ROOT_ENV_FILE, process.env);

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`mail-smtp: ${name} is not set (run pnpm env:sync)`);
  }
  return value;
}

const MAILPIT_TIMEOUT_MS = 5_000;
const SEARCH_ATTEMPTS = 20;
const SEARCH_INTERVAL_MS = 250;

interface MailpitAddress {
  readonly Address: string;
}
interface MailpitSummary {
  readonly ID: string;
  readonly MessageID: string;
  readonly Subject: string;
  readonly To: readonly MailpitAddress[];
}
interface MailpitMessage extends MailpitSummary {
  readonly Text: string;
  readonly HTML: string;
}

/** Message-ID without the angle brackets, as Mailpit's `message-id:` filter takes it. */
function bareMessageId(messageId: string): string {
  return messageId.replace(/^<|>$/g, '');
}

describe('MailPort over SMTP to Mailpit', () => {
  const mailpit = new URL(required('MAIL_UI_URL'));
  let moduleRef: TestingModule | undefined;
  let mail: MailPort;
  const createdIds: string[] = [];

  async function mailpitFetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(new URL(path, mailpit), {
      ...init,
      signal: AbortSignal.timeout(MAILPIT_TIMEOUT_MS),
    });
  }

  beforeAll(async () => {
    // Fail, never skip, when the dev stack is down.
    const info = await mailpitFetch('/api/v1/info').catch(() => undefined);
    if (info?.ok !== true) {
      throw new Error(
        'mail-smtp: Mailpit is not reachable at MAIL_UI_URL (GET /api/v1/info); start the dev stack with pnpm dev:infra',
      );
    }

    const config = loadConfig(
      {
        APP_ENV: 'test',
        // Never connected: the spec imports no database module.
        DATABASE_URL_APP: 'postgres://mail_spec@127.0.0.1:1/unused',
        LOG_LEVEL: 'warn',
        MAIL_ADAPTER: 'smtp',
        MAIL_SMTP_HOST: required('MAIL_SMTP_HOST'),
        MAIL_SMTP_PORT: required('MAIL_SMTP_PORT'),
        ...createEphemeralAuthEnvironment('kd-mail-spec-'),
      },
      'server',
    );
    expect(productionGuardViolations(config)).toEqual([]);

    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule.forRoot(config), LoggingModule, MailModule],
    }).compile();
    mail = moduleRef.get<MailPort>(MAIL_PORT);
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await mailpitFetch('/api/v1/messages', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ IDs: createdIds }),
      });
    }
    await moduleRef?.close();
  });

  async function findByMessageId(messageId: string): Promise<MailpitSummary | undefined> {
    const bare = bareMessageId(messageId);
    const query = new URLSearchParams({ query: `message-id:"${bare}"` });
    for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
      const response = await mailpitFetch(`/api/v1/search?${query.toString()}`);
      expect(response.ok).toBe(true);
      const { messages } = (await response.json()) as { messages: readonly MailpitSummary[] };
      const found = messages.find((message) => bareMessageId(message.MessageID) === bare);
      if (found !== undefined) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, SEARCH_INTERVAL_MS));
    }
    return undefined;
  }

  it('delivers one plain-text VERIFY_EMAIL_CODE message that Mailpit stores', async () => {
    // Fictional recipient and a throw-away code for each run.
    const to = `mail-smtp-${randomUUID()}@example.com`;
    const code = String(randomInt(100_000, 1_000_000));
    const rendered = renderVerifyEmailCode({ code, expiresInMinutes: 10 });

    const messageId = await mail.send({ ...rendered, to });

    expect(messageId).toEqual(expect.any(String));
    const summary = await findByMessageId(messageId as string);
    expect(summary, 'the sent message is not in Mailpit').toBeDefined();
    createdIds.push((summary as MailpitSummary).ID);

    expect(summary?.Subject).toBe(rendered.subject);
    expect(summary?.To.map(({ Address }) => Address)).toEqual([to]);

    const response = await mailpitFetch(`/api/v1/message/${(summary as MailpitSummary).ID}`);
    expect(response.ok).toBe(true);
    const message = (await response.json()) as MailpitMessage;
    expect(message.HTML).toBe('');
    expect(message.Text.split(code)).toHaveLength(2);
  });
});
