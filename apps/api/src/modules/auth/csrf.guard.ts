import type { IncomingHttpHeaders } from 'node:http';

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { ApiError } from '../../common/errors/api-error.js';
import { InjectAppConfig } from '../../config/config.module.js';
import type { ServerConfig } from '../../config/load-config.js';

/** The custom header of decision 0008 section 10 (api-outline, Conventions "Client headers"). */
export const ADMIN_CLIENT_HEADER = 'x-client';
export const ADMIN_CLIENT_VALUE = 'admin-web';

/**
 * The CSRF decision of decision 0008 section 10: `X-Client: admin-web` present (a non-safelisted
 * header, so a cross-site form cannot send it and a cross-origin script needs a preflight the API
 * never grants) AND `Origin` present and exactly one of `allowedOrigins`. A repeated header, a
 * missing or `null` `Origin`, a foreign one or a missing `X-Client` all refuse. No wildcard, no
 * prefix or case-insensitive match.
 */
export function passesCsrfCheck(
  headers: IncomingHttpHeaders,
  allowedOrigins: readonly string[],
): boolean {
  const client = headers[ADMIN_CLIENT_HEADER];
  const origin = headers.origin;
  return (
    typeof client === 'string' &&
    client.trim() === ADMIN_CLIENT_VALUE &&
    typeof origin === 'string' &&
    allowedOrigins.includes(origin)
  );
}

/**
 * Guards every `POST /admin/auth/*` route (decision 0008 section 10): login, refresh and logout
 * here, the MFA, password and step-up routes of later tasks. Refuses with `403 FORBIDDEN`, no
 * detail. The origins come from `ADMIN_ORIGINS` (`ServerConfig.adminOrigins`), read per request.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@InjectAppConfig() private readonly config: ServerConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ readonly headers: IncomingHttpHeaders }>();
    if (!passesCsrfCheck(request.headers, this.config.adminOrigins)) {
      throw new ApiError('FORBIDDEN');
    }
    return true;
  }
}
