import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readEnvironment } from './env-file.js';

describe('readEnvironment', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kd-api-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the env file', () => {
    const file = join(dir, '.env');
    writeFileSync(file, '# comment\nAPP_ENV=dev\nPORT=3001\n');

    expect(readEnvironment(file, {})).toEqual({ APP_ENV: 'dev', PORT: '3001' });
  });

  it('lets the process environment win over the file', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'APP_ENV=dev\nPORT=3001\n');

    expect(readEnvironment(file, { PORT: '4000' })).toEqual({ APP_ENV: 'dev', PORT: '4000' });
  });

  it('uses the process environment alone when the file is missing', () => {
    expect(readEnvironment(join(dir, 'missing.env'), { APP_ENV: 'test' })).toEqual({
      APP_ENV: 'test',
    });
  });
});
