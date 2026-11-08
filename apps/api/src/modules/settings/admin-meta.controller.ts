import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { RequestUser } from '../../common/auth/request-user.js';
import { Roles, STAFF_ROLES } from '../../common/auth/roles.decorator.js';
import { NotBranchScoped } from '../../common/branch-scope/branch-scope.decorator.js';
import { ApiProblemResponses } from '../../common/errors/api-problem-responses.decorator.js';
import { Sensitive } from '../../common/fresh-role/sensitive.decorator.js';
import { AdminSettingsService } from './admin-settings.service.js';
import type { AdminMetaConfigView } from './admin-settings.service.js';
import { AdminMetaConfigDto } from './dto/admin-meta-config.dto.js';

/**
 * `GET /admin/meta/config` (api-outline "Staff session" and AdminMetaConfig; admin-shell-design
 * section 2; brief Z1 to Z4, A13, C33, J13; A4-T2). Every staff role. The stored role and status
 * are re-read (`@Sensitive()`), so a suspended account stops receiving the payment details at
 * once rather than when its access token expires.
 */
@Roles(...STAFF_ROLES)
@Sensitive()
@Controller('admin/meta')
export class AdminMetaController {
  constructor(@Inject(AdminSettingsService) private readonly settings: AdminSettingsService) {}

  /** The caller, their branches, their permission keys and the settings the console reads. */
  @Get('config')
  @NotBranchScoped(
    'Takes no branch parameter: lists the branches of the caller through BranchScopeService.',
  )
  @ApiOkResponse({ type: AdminMetaConfigDto })
  @ApiProblemResponses('UNAUTHENTICATED', 'TOKEN_EXPIRED', 'FORBIDDEN', 'RATE_LIMITED')
  config(@CurrentUser() actor: RequestUser): Promise<AdminMetaConfigView> {
    return this.settings.metaConfig(actor);
  }
}
