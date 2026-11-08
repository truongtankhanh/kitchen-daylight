import { describe, expect, it } from 'vitest';

import type { FirstAdmin } from '../environment.js';
import {
  ADMIN_LOCALE,
  createFirstAdminStep,
  INSERT_ADMIN_SQL,
  planFirstAdmin,
  SELECT_USER_BY_EMAIL_SQL,
} from './first-admin.js';
import { reportLine } from './step.js';
import type { SqlClient } from './step.js';

// Fictional person on a reserved domain.
const ADMIN: FirstAdmin = { email: 'owner@kitchendaylight.example', name: 'Chủ cửa hàng mẫu' };

/** A client that records statements; `exists` answers the SELECT and the INSERT conflict. */
function fakeClient(exists: boolean) {
  const statements: { text: string; values: readonly unknown[] | undefined }[] = [];
  const client: SqlClient = {
    query: async <Row>(text: string, values?: readonly unknown[]) => {
      statements.push({ text, values });
      if (text === SELECT_USER_BY_EMAIL_SQL) {
        return { rows: (exists ? [{ present: 1 }] : []) as Row[] };
      }
      if (text === INSERT_ADMIN_SQL) {
        return { rows: (exists ? [] : [{ id: 'new-id' }]) as Row[] };
      }
      return { rows: [] as Row[] };
    },
  };
  return { client, statements };
}

describe('createFirstAdminStep', () => {
  it('plans and inserts an INVITED ADMIN without password when the email is free', async () => {
    const { client, statements } = fakeClient(false);
    const step = createFirstAdminStep(ADMIN);

    const planned = await step.plan(client);
    const applied = await step.apply(client);

    expect(planned[0]).toMatchObject({ table: 'users', inserted: 1, updated: 0, unchanged: 0 });
    expect(applied.get('users')).toBe(1);
    expect(statements).toEqual([
      { text: SELECT_USER_BY_EMAIL_SQL, values: [ADMIN.email] },
      { text: INSERT_ADMIN_SQL, values: [ADMIN.email, ADMIN.name, ADMIN_LOCALE] },
    ]);
    expect(INSERT_ADMIN_SQL).toContain("'ADMIN', 'INVITED'");
    expect(INSERT_ADMIN_SQL).not.toContain('password_hash');
    expect(INSERT_ADMIN_SQL).not.toContain('mfa_credentials');
  });

  it('skips when a user with that email exists, and never touches it', async () => {
    const { client, statements } = fakeClient(true);
    const step = createFirstAdminStep(ADMIN);

    const planned = await step.plan(client);
    const applied = await step.apply(client);

    expect(planned[0]).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(applied.get('users')).toBe(0);
    expect(statements.every(({ text }) => !/\bUPDATE\b/u.test(text))).toBe(true);
    expect(INSERT_ADMIN_SQL).toContain('ON CONFLICT (email) DO NOTHING');
  });

  it('is skipped without a statement when the variables are unset', async () => {
    const { client, statements } = fakeClient(false);
    const step = createFirstAdminStep(null);

    const planned = await step.plan(client);
    const applied = await step.apply(client);

    expect(planned[0]).toMatchObject({ inserted: 0, unchanged: 0 });
    expect(planned[0]?.note).toContain('skipped');
    expect(applied.get('users')).toBe(0);
    expect(statements).toEqual([]);
  });
});

describe('planFirstAdmin report', () => {
  it('prints the email domain only, never the address or the name', () => {
    for (const exists of [false, true]) {
      const line = reportLine('first-admin', planFirstAdmin(ADMIN, exists));

      expect(line).toContain('@kitchendaylight.example');
      expect(line).not.toContain('owner@');
      expect(line).not.toContain(ADMIN.name);
    }
  });
});
