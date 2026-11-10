import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { APP_CONFIG } from '../../config/config.module.js';
import type { StorageConfig, ServerConfig } from '../../config/load-config.js';
import { S3StorageAdapter } from './adapters/s3/storage.s3.adapter.js';
import type { StorageLogger } from './adapters/s3/storage.s3.adapter.js';
import { KeyCheckedStorage, STORAGE_PORT } from './ports/storage.port.js';

/**
 * Picks the `StoragePort` adapter from the validated config (decision 0005, section 6). `s3` is the
 * only adapter; its kind (`emulator` with an endpoint, `real` without) is the one the production
 * guard checked in `main.ts` (`storageAdapterKind`).
 */
export function createStoragePort(config: StorageConfig, logger: StorageLogger): KeyCheckedStorage {
  switch (config.adapter) {
    case 's3':
      return new KeyCheckedStorage(
        S3StorageAdapter.create(config.s3, logger),
        config.publicBaseUrl,
      );
  }
}

/**
 * Binds `STORAGE_PORT` (decision 0009). Exports the token only, never an adapter class. Image
 * processing and the upload endpoint arrive in A6-T3.
 */
@Module({
  providers: [
    {
      provide: STORAGE_PORT,
      inject: [APP_CONFIG, PinoLogger],
      useFactory: (config: ServerConfig, logger: PinoLogger) => {
        logger.setContext('StoragePort');
        return createStoragePort(config.storage, logger);
      },
    },
  ],
  exports: [STORAGE_PORT],
})
export class MediaModule {}
