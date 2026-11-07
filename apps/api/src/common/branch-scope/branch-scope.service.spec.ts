import type { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import type { UserRole } from '../../modules/users/entities/user.entity.js';
import { ApiError } from '../errors/api-error.js';
import {
  BranchScopeService,
  EXISTING_BRANCH_IDS_SQL,
  HAS_STAFF_BRANCH_SQL,
  STAFF_BRANCH_IDS_SQL,
} from './branch-scope.service.js';

// Fictional ids only.
const USER_ID = '01930000-0000-7000-8000-00000000b5a1';
const BRANCH_A = '01930000-0000-7000-8000-00000000b5b1';
const BRANCH_B = '01930000-0000-7000-8000-00000000b5b2';
const BRANCH_C = '01930000-0000-7000-8000-00000000b5b3';
const UNKNOWN_BRANCH = '01930000-0000-7000-8000-00000000b5bf';

interface Call {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/**
 * A fake repository: an in-memory `staff_branches` and `branches`, answering the three statements
 * of the service the way the TypeORM postgres driver does (rows for `SELECT`). It records every
 * call, so a spec can check that the table is read on every request.
 */
class FakeBranchTables {
  readonly calls: Call[] = [];
  readonly staffBranches = new Map<string, Set<string>>();

  constructor(readonly branchIds: readonly string[] = [BRANCH_A, BRANCH_B, BRANCH_C]) {}

  grant(userId: string, ...ids: string[]): void {
    const set = this.staffBranches.get(userId) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    this.staffBranches.set(userId, set);
  }

  revoke(userId: string, id: string): void {
    this.staffBranches.get(userId)?.delete(id);
  }

  readonly dataSource = {
    query: (sql: string, parameters: unknown[] = []): Promise<unknown[]> => {
      this.calls.push({ sql, parameters });
      if (sql === STAFF_BRANCH_IDS_SQL) {
        const ids = [...(this.staffBranches.get(parameters[0] as string) ?? [])].sort();
        return Promise.resolve(ids.map((branch_id) => ({ branch_id })));
      }
      if (sql === EXISTING_BRANCH_IDS_SQL) {
        const wanted = parameters[0] as string[];
        return Promise.resolve(
          wanted.filter((id) => this.branchIds.includes(id)).map((id) => ({ id })),
        );
      }
      if (sql === HAS_STAFF_BRANCH_SQL) {
        const [userId, branchId] = parameters as [string, string];
        return Promise.resolve(
          this.staffBranches.get(userId)?.has(branchId) === true ? [{ found: 1 }] : [],
        );
      }
      return Promise.reject(new Error(`unexpected SQL: ${sql}`));
    },
  };

  service(): BranchScopeService {
    return new BranchScopeService(this.dataSource as unknown as DataSource);
  }
}

function as(role: UserRole): { id: string; role: UserRole } {
  return { id: USER_ID, role };
}

async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
}

describe('BranchScopeService.resolve', () => {
  describe('ADMIN', () => {
    it('gets ALL without requested ids, with no database read', async () => {
      const tables = new FakeBranchTables();

      expect(await tables.service().resolve(as('ADMIN'))).toEqual({ kind: 'ALL' });
      expect(await tables.service().resolve(as('ADMIN'), [])).toEqual({ kind: 'ALL' });
      expect(tables.calls).toEqual([]);
    });

    it('gets the requested ids when each is a branch, never reading staff_branches', async () => {
      const tables = new FakeBranchTables();

      const scope = await tables.service().resolve(as('ADMIN'), [BRANCH_B, BRANCH_A]);

      expect(scope).toEqual({ kind: 'BRANCHES', branchIds: [BRANCH_B, BRANCH_A] });
      expect(tables.calls.map((call) => call.sql)).toEqual([EXISTING_BRANCH_IDS_SQL]);
    });

    it('answers NOT_FOUND when one requested id is not a branch', async () => {
      const tables = new FakeBranchTables();

      await expectCode(
        tables.service().resolve(as('ADMIN'), [BRANCH_A, UNKNOWN_BRANCH]),
        'NOT_FOUND',
      );
    });

    it('drops duplicates and compares in lower case', async () => {
      const tables = new FakeBranchTables();

      const scope = await tables
        .service()
        .resolve(as('ADMIN'), [BRANCH_A.toUpperCase(), BRANCH_A, BRANCH_B]);

      expect(scope).toEqual({ kind: 'BRANCHES', branchIds: [BRANCH_A, BRANCH_B] });
      expect(tables.calls[0]?.parameters).toEqual([[BRANCH_A, BRANCH_B]]);
    });
  });

  describe.each(['STAFF', 'MANAGER'] as const)('%s', (role) => {
    it('gets the whole set of staff_branches without requested ids', async () => {
      const tables = new FakeBranchTables();
      tables.grant(USER_ID, BRANCH_B, BRANCH_A);

      const scope = await tables.service().resolve(as(role));

      expect(scope).toEqual({ kind: 'BRANCHES', branchIds: [BRANCH_A, BRANCH_B] });
      expect(tables.calls).toEqual([{ sql: STAFF_BRANCH_IDS_SQL, parameters: [USER_ID] }]);
    });

    it('gets the requested ids inside the set', async () => {
      const tables = new FakeBranchTables();
      tables.grant(USER_ID, BRANCH_A, BRANCH_B);

      expect(await tables.service().resolve(as(role), [BRANCH_B])).toEqual({
        kind: 'BRANCHES',
        branchIds: [BRANCH_B],
      });
    });

    it('answers NOT_FOUND, never FORBIDDEN, for a requested id outside the set', async () => {
      const tables = new FakeBranchTables();
      tables.grant(USER_ID, BRANCH_A);

      await expectCode(tables.service().resolve(as(role), [BRANCH_B]), 'NOT_FOUND');
      await expectCode(tables.service().resolve(as(role), [BRANCH_A, BRANCH_B]), 'NOT_FOUND');
      await expectCode(tables.service().resolve(as(role), [UNKNOWN_BRANCH]), 'NOT_FOUND');
    });

    it('gets an empty set without a staff_branches row', async () => {
      const tables = new FakeBranchTables();

      expect(await tables.service().resolve(as(role))).toEqual({
        kind: 'BRANCHES',
        branchIds: [],
      });
      await expectCode(tables.service().resolve(as(role), [BRANCH_A]), 'NOT_FOUND');
    });

    it('reads staff_branches on every call, so a revoked branch takes effect at once', async () => {
      const tables = new FakeBranchTables();
      tables.grant(USER_ID, BRANCH_A, BRANCH_B);
      const service = tables.service();

      expect(await service.resolve(as(role))).toEqual({
        kind: 'BRANCHES',
        branchIds: [BRANCH_A, BRANCH_B],
      });
      tables.revoke(USER_ID, BRANCH_B);

      expect(await service.resolve(as(role))).toEqual({ kind: 'BRANCHES', branchIds: [BRANCH_A] });
      await expectCode(service.resolve(as(role), [BRANCH_B]), 'NOT_FOUND');
      expect(tables.calls.filter((call) => call.sql === STAFF_BRANCH_IDS_SQL)).toHaveLength(3);
    });
  });

  it('refuses a customer with FORBIDDEN, reading nothing', async () => {
    const tables = new FakeBranchTables();

    await expectCode(tables.service().resolve(as('CUSTOMER')), 'FORBIDDEN');
    await expectCode(tables.service().resolve(as('CUSTOMER'), [BRANCH_A]), 'FORBIDDEN');
    expect(tables.calls).toEqual([]);
  });
});

describe('BranchScopeService.assertBranchAccess', () => {
  it('lets ADMIN through without a database read', async () => {
    const tables = new FakeBranchTables();

    await expect(tables.service().assertBranchAccess(as('ADMIN'), BRANCH_A)).resolves.toBe(
      undefined,
    );
    expect(tables.calls).toEqual([]);
  });

  it.each(['STAFF', 'MANAGER'] as const)(
    'lets %s through on one of their branches, NOT_FOUND otherwise',
    async (role) => {
      const tables = new FakeBranchTables();
      tables.grant(USER_ID, BRANCH_A);
      const service = tables.service();

      await expect(service.assertBranchAccess(as(role), BRANCH_A)).resolves.toBe(undefined);
      await expectCode(service.assertBranchAccess(as(role), BRANCH_B), 'NOT_FOUND');
      expect(tables.calls.at(-1)).toEqual({
        sql: HAS_STAFF_BRANCH_SQL,
        parameters: [USER_ID, BRANCH_B],
      });
    },
  );

  it('refuses a customer with FORBIDDEN', async () => {
    const tables = new FakeBranchTables();

    await expectCode(tables.service().assertBranchAccess(as('CUSTOMER'), BRANCH_A), 'FORBIDDEN');
  });
});
