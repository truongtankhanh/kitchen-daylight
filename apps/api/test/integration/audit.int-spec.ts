import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuditEntry } from '../../src/modules/audit/audit.service.js';
import { openAppDataSource, openAppRole, openRoleClient } from '../support/app-role.js';
import type { RoleClient } from '../support/app-role.js';
import { truncateAll } from '../support/truncate.js';

// Migration 0003_audit_logs (A0-T7): append-only for kd_app (testing-strategy, "Reviews and
// reports"). Fictional ids and labels only.
const ACTOR_ID = '01900000-0000-7000-8000-00000000a001';

const ENTRY: AuditEntry = {
  actorUserId: ACTOR_ID,
  action: 'settings.change',
  entityType: 'APP_SETTINGS',
  entityId: 'ordering',
  entityLabel: 'Ordering settings',
  diff: { leadTimeMinutes: { from: 15, to: 20 } },
};

/** The four indexes of data-model (brief G6) with their key columns, plus the primary key. */
const EXPECTED_INDEXES: Readonly<Record<string, string>> = {
  audit_logs_pkey: '(id)',
  audit_logs_entity_idx: '(entity_type, entity_id, created_at)',
  audit_logs_branch_idx: '(branch_id, created_at DESC)',
  audit_logs_actor_idx: '(actor_user_id, created_at)',
  audit_logs_created_at_idx: '(created_at DESC, id DESC)',
};

describe('audit_logs (0003_audit_logs)', () => {
  let app: RoleClient;
  let dataSource: DataSource;
  let service: AuditService;

  beforeAll(async () => {
    app = await openAppRole();
    dataSource = await openAppDataSource();
    service = new AuditService(dataSource);
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('lets kd_app insert (through AuditService) and select', async () => {
    await service.write(ENTRY);

    const rows = await app.query<Record<string, unknown>>(
      `SELECT actor_user_id, action, entity_type::text AS entity_type, entity_id, entity_label,
              branch_id, diff
         FROM public.audit_logs`,
    );
    expect(rows).toEqual([
      {
        actor_user_id: ACTOR_ID,
        action: 'settings.change',
        entity_type: 'APP_SETTINGS',
        entity_id: 'ordering',
        entity_label: 'Ordering settings',
        branch_id: null,
        diff: { leadTimeMinutes: { from: 15, to: 20 } },
      },
    ]);
  });

  it('denies UPDATE, DELETE and TRUNCATE to kd_app (42501)', async () => {
    await service.write(ENTRY);

    await app.expectPermissionDenied(`UPDATE public.audit_logs SET entity_label = 'Changed'`);
    await app.expectPermissionDenied('DELETE FROM public.audit_logs');
    await app.expectPermissionDenied('TRUNCATE TABLE public.audit_logs');

    const rows = await app.query<{ count: number; label: string }>(
      'SELECT count(*)::int AS count, max(entity_label) AS label FROM public.audit_logs',
    );
    expect(rows[0]).toEqual({ count: 1, label: 'Ordering settings' });
  });

  it('stores created_at to the millisecond, the precision of the cursor sort key (0006)', async () => {
    await dataSource.transaction(async (manager) => {
      await service.write(ENTRY, manager);
      await service.write({ ...ENTRY, entityId: 'ordering-2' }, manager);
    });

    const columns = await app.query<{ type: string }>(
      `SELECT format_type(atttypid, atttypmod) AS type
         FROM pg_attribute
        WHERE attrelid = 'public.audit_logs'::regclass AND attname = 'created_at'`,
    );
    expect(columns).toEqual([{ type: 'timestamp(3) with time zone' }]);

    // Both rows of one transaction share now(); a Date read back equals the stored value exactly.
    const rows = await app.query<{ exact: boolean; created_at: Date }>(
      `SELECT created_at = date_trunc('milliseconds', created_at) AS exact, created_at
         FROM public.audit_logs ORDER BY created_at DESC, id DESC`,
    );
    expect(rows.map((row) => row.exact)).toEqual([true, true]);
    const [first] = rows;
    const matched = await app.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.audit_logs WHERE created_at = $1',
      [first?.created_at],
    );
    expect(matched).toEqual([{ count: 2 }]);
  });

  it('has the four indexes of the data model', async () => {
    const migrator = await openRoleClient('kd_migrator');
    try {
      const rows = await migrator.query<{ name: string; definition: string }>(
        `SELECT indexname AS name, indexdef AS definition
           FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'audit_logs'
          ORDER BY indexname`,
      );

      expect(rows.map((row) => row.name).sort()).toEqual(Object.keys(EXPECTED_INDEXES).sort());
      for (const row of rows) {
        expect(row.definition, row.name).toContain(EXPECTED_INDEXES[row.name]);
      }
    } finally {
      await migrator.close();
    }
  });
});
