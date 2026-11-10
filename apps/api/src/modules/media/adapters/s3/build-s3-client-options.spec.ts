import { describe, expect, it } from 'vitest';

import type { S3Settings } from '../../../../config/load-config.js';
import { createStoragePort } from '../../media.module.js';
import { buildS3ClientOptions, storageAdapterKind } from './build-s3-client-options.js';

// Decision 0009 section 8 (A6-T2). Fictional names; the keys are local placeholders.
const BUCKETS = Object.freeze({ media: 'kd-spec-media', private: 'kd-spec-private' });
const CREDENTIALS = Object.freeze({
  accessKeyId: 'kd-spec-access-key',
  secretAccessKey: 'kd-spec-secret-key',
});

const EMULATOR: S3Settings = {
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9020',
  forcePathStyle: true,
  credentials: CREDENTIALS,
  buckets: BUCKETS,
};

const AWS: S3Settings = {
  region: 'ap-southeast-1',
  endpoint: null,
  forcePathStyle: false,
  credentials: null,
  buckets: BUCKETS,
};

const LOGGER = { warn: () => undefined };

describe('buildS3ClientOptions', () => {
  it('points the emulator client at its endpoint, path style, static keys and WHEN_REQUIRED checksums', () => {
    expect(buildS3ClientOptions(EMULATOR)).toEqual({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:9020',
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: CREDENTIALS,
    });
  });

  it('keeps the SDK defaults on AWS: no endpoint, no path style, no checksum override, no keys', () => {
    expect(buildS3ClientOptions(AWS)).toEqual({ region: 'ap-southeast-1' });
  });

  it('passes path style false through for an emulator that serves virtual hosts', () => {
    expect(buildS3ClientOptions({ ...EMULATOR, forcePathStyle: false })).toMatchObject({
      forcePathStyle: false,
    });
  });

  it('leaves credentials to the default provider chain when no keys are set', () => {
    expect(buildS3ClientOptions({ ...EMULATOR, credentials: null })).not.toHaveProperty(
      'credentials',
    );
  });

  it('never carries the bucket names into the client options', () => {
    expect(JSON.stringify(buildS3ClientOptions(EMULATOR))).not.toContain('kd-spec-media');
  });
});

describe('storageAdapterKind', () => {
  it('is emulator with an endpoint and real without one', () => {
    expect(storageAdapterKind(EMULATOR)).toBe('emulator');
    expect(storageAdapterKind(AWS)).toBe('real');
  });

  it.each([
    ['an endpoint', EMULATOR],
    ['no endpoint', AWS],
  ])('matches the kind the bound adapter declares, with %s', (_label, s3) => {
    const port = createStoragePort(
      { adapter: 's3', publicBaseUrl: 'https://media.kitchendaylight.example', s3 },
      LOGGER,
    );

    expect(port.kind).toBe(storageAdapterKind(s3));
  });
});
