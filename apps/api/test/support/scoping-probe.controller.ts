import { Controller, Get, Inject, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { STAFF_ROLES, Roles } from '../../src/common/auth/roles.decorator.js';
import { BranchIds } from '../../src/common/branch-scope/branch-ids.decorator.js';
import {
  BranchScoped,
  NotBranchScoped,
} from '../../src/common/branch-scope/branch-scope.decorator.js';
import type { BranchScope } from '../../src/common/branch-scope/branch-scope.service.js';

// Test-only controller (A3-T5), mounted only by `branch-scoping.int-spec.ts` through
// `createTestApp({ imports: [ScopingProbeModule] })`; never by `AppModule`. Until a slice applies
// `@BranchScoped` to a real endpoint (A5-T6 first) it gives the scoping machinery one route of each
// kind: a list, an action on one branch, and a deliberately global staff route.

export const PROBE_BASE = '/api/v1/admin/test-branch-scope';
export const PROBE_LIST_ROUTE = `GET ${PROBE_BASE}/items`;
export const PROBE_ACTION_ROUTE = `GET ${PROBE_BASE}/branches/:id`;
export const PROBE_GLOBAL_ROUTE = `GET ${PROBE_BASE}/global`;

export interface ProbeListBody {
  readonly items: readonly { readonly branchId: string }[];
}

const LIST_ALL_SQL = `SELECT id::text AS id FROM public.branches
 WHERE deleted_at IS NULL ORDER BY id`;
const LIST_SOME_SQL = `SELECT id::text AS id FROM public.branches
 WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id`;

@Roles(...STAFF_ROLES)
@Controller('admin/test-branch-scope')
export class ScopingProbeController {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** A list route: one item per visible branch, soft-deleted branches left out (as a list must). */
  @BranchScoped({ query: 'branchIds' })
  @Get('items')
  async list(@BranchIds() scope: BranchScope): Promise<ProbeListBody> {
    const rows: { id: string }[] =
      scope.kind === 'ALL'
        ? await this.dataSource.query(LIST_ALL_SQL)
        : await this.dataSource.query(LIST_SOME_SQL, [scope.branchIds]);
    return { items: rows.map((row) => ({ branchId: row.id })) };
  }

  /** An action on one branch, the path id being the branch. */
  @BranchScoped({ param: 'id' })
  @Get('branches/:id')
  branch(@Param('id', new ParseUUIDPipe()) id: string): { branchId: string } {
    return { branchId: id };
  }

  /** A staff route that is global by design. */
  @NotBranchScoped('Test probe: a staff route that reads no branch data.')
  @Get('global')
  global(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [ScopingProbeController] })
export class ScopingProbeModule {}
