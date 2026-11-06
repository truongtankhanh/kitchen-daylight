import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

import { CurrentUser } from '../../src/common/auth/current-user.decorator.js';
import { Public } from '../../src/common/auth/public.decorator.js';
import type { RequestUser } from '../../src/common/auth/request-user.js';
import { ADMIN_ROLES, Roles, STAFF_ROLES } from '../../src/common/auth/roles.decorator.js';
import { ApiError } from '../../src/common/errors/api-error.js';

// Test-only controllers (A1-T7), imported by the integration specs through
// `createTestApp({ imports: [TestRoutesModule] })`; never by `AppModule`. They give the
// deny-by-default enumeration non-trivial routes (path parameters, a body, `@Roles`, an admin
// route without `@Roles`) and the throttling spec one route under each strict prefix.

/**
 * Refuses a body without a non-empty string `name` with `400 VALIDATION_FAILED`. An explicit pipe
 * instance, so the check does not depend on emitted decorator metadata (decision 0007 section 2):
 * a `401` on an empty body proves that the guards ran before any pipe.
 */
class RequireNamePipe implements PipeTransform {
  transform(value: unknown): unknown {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || name === '') {
      throw new ApiError('VALIDATION_FAILED');
    }
    return value;
  }
}

/** `customer` routes: any signed-in user. */
@Controller('test-guards')
export class TestCustomerRoutesController {
  @Get('me')
  me(@CurrentUser() user: RequestUser): RequestUser {
    return { id: user.id, role: user.role };
  }

  @Get('items/:id')
  item(@Param('id', new ParseUUIDPipe()) id: string): { id: string } {
    return { id };
  }

  @Post('items')
  create(@Body(new RequireNamePipe()) body: { name: string }): { name: string } {
    return { name: body.name };
  }
}

/** A `staff` route outside `/admin`. */
@Roles(...STAFF_ROLES)
@Controller('test-guards/staff')
export class TestStaffRoutesController {
  @Get()
  board(): { ok: true } {
    return { ok: true };
  }
}

/** Admin routes: one per role set, and one without `@Roles` (the safety net refuses it). */
@Controller('admin/test-guards')
export class TestAdminRoutesController {
  @Roles(...STAFF_ROLES)
  @Get('staff')
  staff(): { ok: true } {
    return { ok: true };
  }

  @Get('unmarked')
  unmarked(): { ok: true } {
    return { ok: true };
  }

  @Roles(...ADMIN_ROLES)
  @Delete('items/:id')
  remove(@Param('id', new ParseUUIDPipe()) id: string): { id: string } {
    return { id };
  }
}

/** A lenient public route (the `default` throttler). */
@Public()
@Controller('test-guards/public')
export class TestPublicRoutesController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

/** Strict prefix `/api/v1/auth/`, unlisted in the 0008 table: 5 per 15 minutes. */
@Public()
@Controller('auth/test-throttle')
export class TestAuthThrottleController {
  @Post()
  @HttpCode(204)
  hit(): void {
    return undefined;
  }
}

/** Strict prefix `/api/v1/admin/auth/`, unlisted in the 0008 table: 5 per 15 minutes. */
@Public()
@Controller('admin/auth/test-throttle')
export class TestAdminAuthThrottleController {
  @Post()
  @HttpCode(204)
  hit(): void {
    return undefined;
  }
}

@Module({
  controllers: [
    TestCustomerRoutesController,
    TestStaffRoutesController,
    TestAdminRoutesController,
    TestPublicRoutesController,
    TestAuthThrottleController,
    TestAdminAuthThrottleController,
  ],
})
export class TestRoutesModule {}

/** Every `@Public()` route of the app with `TestRoutesModule`, as `METHOD path`. */
export const EXPECTED_PUBLIC_ROUTES: readonly string[] = [
  'GET /api/health',
  'GET /api/v1/test-guards/public',
  'POST /api/v1/auth/test-throttle',
  'POST /api/v1/admin/auth/test-throttle',
];
