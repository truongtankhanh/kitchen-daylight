import type { S3ClientConfig } from '@aws-sdk/client-s3';

import type { AdapterKind } from '../../../../config/adapter-kind.js';
import type { S3Settings } from '../../../../config/load-config.js';

/**
 * The kind of the S3 adapter (decision 0009 section 9): `emulator` when an endpoint is set, `real`
 * otherwise. Static, so `main.ts` runs the production guard before Nest boots.
 */
export function storageAdapterKind(s3: Pick<S3Settings, 'endpoint'>): AdapterKind {
  return s3.endpoint === null ? 'real' : 'emulator';
}

/**
 * Pure: the `S3Client` options of decision 0009 section 8.
 * - Endpoint and path style only for the emulator.
 * - Static credentials only when both keys are set; otherwise the SDK's default provider chain
 *   (the instance profile in `demo` and `prod`).
 * - The emulator gets `WHEN_REQUIRED` checksums: no SeaweedFS document states support for the SDK's
 *   default CRC32 checksums on every request. AWS keeps the defaults (`WHEN_SUPPORTED`).
 */
export function buildS3ClientOptions(s3: S3Settings): S3ClientConfig {
  return {
    region: s3.region,
    ...(s3.endpoint === null
      ? {}
      : {
          endpoint: s3.endpoint,
          forcePathStyle: s3.forcePathStyle,
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }),
    ...(s3.credentials === null
      ? {}
      : {
          credentials: {
            accessKeyId: s3.credentials.accessKeyId,
            secretAccessKey: s3.credentials.secretAccessKey,
          },
        }),
  };
}
