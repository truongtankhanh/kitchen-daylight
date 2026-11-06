import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { Clock, SystemClock } from '../../common/time/clock.js';
import { PasswordHasher } from './password-hasher.js';
import { PendingUserSessionRevoker, UserSessionRevoker, UsersService } from './users.service.js';
import { UsersModule } from './users.module.js';

/** Stands in for the global `DataSource` that TypeORM registers in the application. */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class StubDataSourceModule {}

describe('UsersModule', () => {
  it('provides UsersService and PasswordHasher, with the fail-closed session revoker', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, UsersModule],
    }).compile();

    expect(moduleRef.get(UsersService)).toBeInstanceOf(UsersService);
    expect(moduleRef.get(PasswordHasher)).toBeInstanceOf(PasswordHasher);
    expect(moduleRef.get(UserSessionRevoker, { strict: false })).toBeInstanceOf(
      PendingUserSessionRevoker,
    );
    expect(moduleRef.get(Clock, { strict: false })).toBeInstanceOf(SystemClock);

    await moduleRef.close();
  });
});
