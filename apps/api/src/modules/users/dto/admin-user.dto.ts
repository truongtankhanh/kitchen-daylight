import { ApiExtraModels, ApiProperty, ApiSchema, getSchemaPath } from '@nestjs/swagger';

import { STAFF_ROLES } from '../../../common/auth/roles.decorator.js';
import type {
  AdminCustomerUserView,
  AdminStaffUserView,
  AdminUserBranchView,
  AdminUserContactView,
  AdminUserMfaView,
  AdminUserPage,
} from '../admin-users.service.js';
import { USER_STATUSES } from '../entities/user.entity.js';
import type { UserStatus } from '../entities/user.entity.js';

/** A branch of a staff account (`staff_branches`). */
@ApiSchema({ name: 'AdminUserBranch' })
export class AdminUserBranchDto implements AdminUserBranchView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  code!: string;
}

/** The second factor of a staff account (ADR-0009 WA4). */
@ApiSchema({ name: 'AdminUserMfa' })
export class AdminUserMfaDto implements AdminUserMfaView {
  /** True for `MANAGER` and `ADMIN`. */
  required!: boolean;

  /** A confirmed TOTP credential exists. */
  enabled!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  enabledAt!: string | null;
}

/** A staff item of `GET /admin/users` (brief E14), also the body of `POST` and staff `PATCH`. */
@ApiSchema({ name: 'AdminStaffUser' })
export class AdminStaffUserDto implements AdminStaffUserView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  displayName!: string;

  /** Staff emails are shown in full: they are work addresses (brief E14). */
  email!: string;

  @ApiProperty({ enum: STAFF_ROLES })
  role!: AdminStaffUserView['role'];

  @ApiProperty({ enum: USER_STATUSES })
  status!: UserStatus;

  /** Empty for `ADMIN`, who ignores branches. */
  @ApiProperty({ type: AdminUserBranchDto, isArray: true })
  branches!: AdminUserBranchDto[];

  @ApiProperty({ type: AdminUserMfaDto })
  mfa!: AdminUserMfaDto;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt!: string | null;
}

/**
 * A customer item of `GET /admin/users` (brief E12, M19), also the body of a customer `PATCH`. The
 * contact is masked (`n***@example.com`, `+84******567`); the full value only through
 * `reveal-contact`. `role` tells the two item shapes apart (api-divergences D-089).
 */
@ApiSchema({ name: 'AdminCustomerUser' })
export class AdminCustomerUserDto implements AdminCustomerUserView {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['CUSTOMER'] })
  role!: 'CUSTOMER';

  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  emailMasked!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phoneMasked!: string | null;

  @ApiProperty({ enum: USER_STATUSES })
  status!: UserStatus;

  @ApiProperty({ type: 'integer', minimum: 0 })
  ordersCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastOrderAt!: string | null;

  @ApiProperty({ type: 'integer' })
  pointsBalance!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  completedOrders!: number;
}

/** `GET /api/v1/admin/users`: an offset page of staff and customer items. */
@ApiSchema({ name: 'AdminUserPage' })
@ApiExtraModels(AdminStaffUserDto, AdminCustomerUserDto)
export class AdminUserPageDto implements AdminUserPage {
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(AdminStaffUserDto) },
        { $ref: getSchemaPath(AdminCustomerUserDto) },
      ],
    },
  })
  items!: (AdminStaffUserDto | AdminCustomerUserDto)[];

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;

  /** `ACTIVE` admins with a confirmed second factor, for the "two administrators" banner. */
  @ApiProperty({ type: 'integer', minimum: 0 })
  activeAdminsWithMfa!: number;
}

/** `POST /api/v1/admin/users/{id}/reveal-contact`: the full contact, audited. */
@ApiSchema({ name: 'AdminUserContact' })
export class AdminUserContactDto implements AdminUserContactView {
  email!: string;

  /** E.164; `null` when the account has none. */
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}
