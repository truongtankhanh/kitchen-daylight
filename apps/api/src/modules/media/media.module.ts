import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { clockProvider } from '../../common/time/clock.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { StorageConfig, ServerConfig } from '../../config/load-config.js';
import { S3StorageAdapter } from './adapters/s3/storage.s3.adapter.js';
import type { StorageLogger } from './adapters/s3/storage.s3.adapter.js';
import { AdminUploadsController } from './admin-uploads.controller.js';
import { MediaService } from './media.service.js';
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
 * Media (decision 0009). A6-T2: binds `STORAGE_PORT`. A6-T3: the `media` table,
 * `POST /admin/uploads/images` and `MediaService` (`assertUsable`, `setAlt`, `toImage`,
 * `findOrphans` for later tasks). Uses the application's global TypeORM `DataSource`. Exports the
 * token and the service, never an adapter class.
 */
@Module({
  controllers: [AdminUploadsController],
  providers: [
    {
      provide: STORAGE_PORT,
      inject: [APP_CONFIG, PinoLogger],
      useFactory: (config: ServerConfig, logger: PinoLogger) => {
        logger.setContext('StoragePort');
        return createStoragePort(config.storage, logger);
      },
    },
    MediaService,
    clockProvider,
  ],
  exports: [STORAGE_PORT, MediaService],
})
export class MediaModule {}
