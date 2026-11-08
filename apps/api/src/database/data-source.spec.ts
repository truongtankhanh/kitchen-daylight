import { describe, expect, it } from 'vitest';

import { IdempotencyKeyRecord } from '../common/idempotency/entities/idempotency-key.entity.js';
import { AuditLog } from '../modules/audit/entities/audit-log.entity.js';
import { AuthIdentity } from '../modules/auth/entities/auth-identity.entity.js';
import { EmailToken } from '../modules/auth/entities/email-token.entity.js';
import { MfaCredential } from '../modules/auth/entities/mfa-credential.entity.js';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity.js';
import { Branch } from '../modules/branches/entities/branch.entity.js';
import { Province } from '../modules/geo/entities/province.entity.js';
import { Ward } from '../modules/geo/entities/ward.entity.js';
import { OutboxEvent } from '../modules/realtime/entities/outbox-event.entity.js';
import { AppSetting } from '../modules/settings/entities/app-setting.entity.js';
import { ConsentDocument } from '../modules/users/entities/consent-document.entity.js';
import { CustomerAddress } from '../modules/users/entities/customer-address.entity.js';
import { StaffBranch } from '../modules/users/entities/staff-branch.entity.js';
import { UserConsent } from '../modules/users/entities/user-consent.entity.js';
import { User } from '../modules/users/entities/user.entity.js';
import { createDataSourceOptions, describeDatabaseTarget, MIGRATIONS_DIR } from './data-source.js';

const URL_WITH_SECRET =
  'postgres://kd_migrator:CHANGE_ME_LOCAL@127.0.0.1:5452/kd_dev?sslmode=disable';

describe('createDataSourceOptions', () => {
  it('never synchronizes or runs TypeORM migrations, and lists its entities explicitly', () => {
    const options = createDataSourceOptions({ appEnv: 'dev', database: { url: URL_WITH_SECRET } });

    expect(options).toMatchObject({
      type: 'postgres',
      url: URL_WITH_SECRET,
      synchronize: false,
      migrationsRun: false,
      migrations: [],
      entities: [
        OutboxEvent,
        AuditLog,
        IdempotencyKeyRecord,
        Branch,
        User,
        StaffBranch,
        AuthIdentity,
        RefreshToken,
        EmailToken,
        MfaCredential,
        ConsentDocument,
        UserConsent,
        Province,
        Ward,
        CustomerAddress,
        AppSetting,
      ],
    });
  });

  it('points at apps/api/migrations', () => {
    expect(MIGRATIONS_DIR).toMatch(/[\\/]apps[\\/]api[\\/]migrations[\\/]$/);
  });
});

describe('describeDatabaseTarget', () => {
  it('keeps host, port and database name only', () => {
    expect(describeDatabaseTarget(URL_WITH_SECRET)).toBe('127.0.0.1:5452/kd_dev');
  });

  it('defaults the port to 5432', () => {
    expect(describeDatabaseTarget('postgres://kd_app@db/kd')).toBe('db:5432/kd');
  });

  it('prints nothing of an unparsable URL', () => {
    expect(describeDatabaseTarget('not a url')).toBe('the configured database');
  });
});
